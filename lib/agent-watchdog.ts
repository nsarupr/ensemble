import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { AgentRuntime } from './agent-runtime'
import type { EnsembleMessage, EnsembleTeam } from '../types/ensemble'

const DEFAULT_POLL_INTERVAL_MS = 30_000
const DEFAULT_NUDGE_MS = 900_000
const DEFAULT_STALL_MS = 1_200_000
const PROMPT_DETECT_STALE_MS = 10_000
const WATCHDOG_NUDGE_TEXT = 'Are you still working? Share your progress with team-say.'

// Patterns that indicate an agent is waiting for user input
const PROMPT_PATTERNS = [
  /Do you want to proceed\?/i,
  /Esc to cancel/,
  /approve.*deny/i,
  /Yes,?\s+and don't ask/i,
  /❯\s+\d+\.\s+(Yes|No)/,
  /\d+\.\s+Yes.*\d+\.\s+No/s,
  /Allow once/i,
  /permission/i,
]

interface AgentWatchdogState {
  lastMessageAt: string
  nudgedAt?: string
  stalledAt?: string
  lastPaneContent?: string
  lastPaneChangeAt?: number
  promptNotified?: boolean
}

interface AgentWatchdogDeps {
  loadTeams: () => EnsembleTeam[]
  getMessages: (teamId: string) => EnsembleMessage[]
  appendMessage: (teamId: string, message: EnsembleMessage) => void
  getRuntime: () => Pick<AgentRuntime, 'sendKeys' | 'pasteFromFile' | 'capturePane' | 'sessionExists'>
  resolveAgentProgram: (program: string) => { inputMethod: 'pasteFromFile' | 'sendKeys' }
  isSelf: (hostId?: string) => boolean
  getHostById: (hostId: string) => { url: string } | undefined
  postRemoteSessionCommand: (url: string, sessionName: string, text: string) => Promise<void>
  collabDeliveryFile: (teamId: string, sessionName: string) => string
  now?: () => number
  nudgeAfterMs?: number
  stallAfterMs?: number
  pollIntervalMs?: number
}

function parseDuration(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getWatchdogNudgeMs(): number {
  return parseDuration(process.env.ENSEMBLE_WATCHDOG_NUDGE_MS, DEFAULT_NUDGE_MS)
}

export function getWatchdogStallMs(): number {
  return parseDuration(process.env.ENSEMBLE_WATCHDOG_STALL_MS, DEFAULT_STALL_MS)
}

export class AgentWatchdog {
  private readonly state = new Map<string, AgentWatchdogState>()
  private readonly timer: NodeJS.Timeout
  private readonly now: () => number
  private readonly nudgeAfterMs: number
  private readonly stallAfterMs: number

  constructor(private readonly deps: AgentWatchdogDeps) {
    this.now = deps.now ?? Date.now
    this.nudgeAfterMs = deps.nudgeAfterMs ?? getWatchdogNudgeMs()
    this.stallAfterMs = deps.stallAfterMs ?? getWatchdogStallMs()

    this.timer = setInterval(() => {
      void this.poll()
    }, deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    this.timer.unref()
  }

  async poll(): Promise<void> {
    const activeTeams = this.deps.loadTeams().filter(team => team.status === 'active')
    const activeTeamIds = new Set(activeTeams.map(team => team.id))

    for (const key of this.state.keys()) {
      const teamId = key.split(':', 1)[0]
      if (!activeTeamIds.has(teamId)) this.state.delete(key)
    }

    for (const team of activeTeams) {
      await this.pollTeam(team)
    }
  }

  stop(): void {
    clearInterval(this.timer)
    this.state.clear()
  }

  private async pollTeam(team: EnsembleTeam): Promise<void> {
    const messages = this.deps.getMessages(team.id)
    const activeAgents = team.agents.filter(candidate => candidate.status === 'active')
    const activeAgentNames = new Set(activeAgents.map(agent => agent.name))

    for (const key of this.state.keys()) {
      if (!key.startsWith(`${team.id}:`)) continue
      const agentName = key.slice(team.id.length + 1)
      if (!activeAgentNames.has(agentName)) this.state.delete(key)
    }

    for (const agent of activeAgents) {
      const stateKey = `${team.id}:${agent.name}`
      const lastAgentMessage = [...messages].reverse().find(message => message.from === agent.name)
      const lastMessageAt = lastAgentMessage?.timestamp || team.createdAt
      const previousState = this.state.get(stateKey)

      if (!previousState) {
        this.state.set(stateKey, { lastMessageAt })
      } else if (previousState.lastMessageAt !== lastMessageAt) {
        this.state.set(stateKey, { lastMessageAt })
        continue
      }

      const lastMessageMs = new Date(lastMessageAt).getTime()
      if (Number.isNaN(lastMessageMs)) continue

      const nowMs = this.now()
      const idleMs = nowMs - lastMessageMs
      const currentState = this.state.get(stateKey) ?? { lastMessageAt }

      if (!currentState.nudgedAt && idleMs >= this.nudgeAfterMs) {
        try {
          await this.nudgeAgent(team, agent.name, agent.program, agent.hostId)
          this.state.set(stateKey, {
            lastMessageAt,
            nudgedAt: new Date(nowMs).toISOString(),
          })
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          this.deps.appendMessage(team.id, {
            id: uuidv4(),
            teamId: team.id,
            from: 'ensemble',
            to: 'team',
            content: `❌ Watchdog failed to nudge ${agent.name}: ${reason}`,
            type: 'chat',
            timestamp: new Date(nowMs).toISOString(),
          })
        }
        continue
      }

      if (!currentState.nudgedAt || currentState.stalledAt) continue

      const nudgedMs = new Date(currentState.nudgedAt).getTime()
      if (Number.isNaN(nudgedMs) || nowMs - nudgedMs < this.stallAfterMs) continue

      console.warn(`[Watchdog] Agent ${agent.name} in team ${team.id} stalled after watchdog nudge`)
      this.deps.appendMessage(team.id, {
        id: uuidv4(),
        teamId: team.id,
        from: 'ensemble',
        to: 'team',
        content: `⚠️ Watchdog marked ${agent.name} as stalled after ${Math.round((nowMs - nudgedMs) / 1000)}s without progress after nudge`,
        type: 'chat',
        timestamp: new Date(nowMs).toISOString(),
      })
      this.state.set(stateKey, {
        ...currentState,
        stalledAt: new Date(nowMs).toISOString(),
      })
    }

    // Always check for interactive prompts regardless of nudge/stall state
    for (const agent of activeAgents) {
      const stateKey = `${team.id}:${agent.name}`
      await this.checkForPrompt(team, agent, stateKey)
    }
  }

  private async checkForPrompt(team: EnsembleTeam, agent: { name: string; hostId?: string }, stateKey: string): Promise<void> {
    const sessionName = `${team.name}-${agent.name}`
    if (agent.hostId && !this.deps.isSelf(agent.hostId)) return

    const runtime = this.deps.getRuntime()
    try {
      const alive = await runtime.sessionExists(sessionName)
      if (!alive) return

      const paneContent = await runtime.capturePane(sessionName, 30)
      const trimmed = paneContent.trim()
      if (!trimmed) return

      const currentState = this.state.get(stateKey)
      if (!currentState) return

      const nowMs = this.now()

      // Check if pane content changed
      if (currentState.lastPaneContent !== trimmed) {
        this.state.set(stateKey, {
          ...currentState,
          lastPaneContent: trimmed,
          lastPaneChangeAt: nowMs,
          promptNotified: false,
        })
        return
      }

      // Pane hasn't changed — check if it's been stale long enough
      const staleMs = nowMs - (currentState.lastPaneChangeAt || nowMs)
      if (staleMs < PROMPT_DETECT_STALE_MS) return
      if (currentState.promptNotified) return

      // Check if it looks like a prompt
      const isPrompt = PROMPT_PATTERNS.some(p => p.test(trimmed))
      if (!isPrompt) return

      // Extract the last 8 lines as the prompt excerpt
      const promptLines = trimmed.split('\n').slice(-8).join('\n')

      this.deps.appendMessage(team.id, {
        id: uuidv4(),
        teamId: team.id,
        from: 'ensemble',
        to: 'team',
        content: `⚠️ ${agent.name} needs input:\n${promptLines}\n\n→ In monitor: press ! then agent number to send raw keystrokes`,
        type: 'chat',
        timestamp: new Date(nowMs).toISOString(),
      })

      this.state.set(stateKey, {
        ...currentState,
        promptNotified: true,
      })

      console.log(`[Watchdog] Prompt detected for ${agent.name} in team ${team.id}`)
    } catch {
      // Capture failed — session may be gone
    }
  }

  private async nudgeAgent(team: EnsembleTeam, agentName: string, _program: string, hostId?: string): Promise<void> {
    const timestamp = new Date(this.now()).toISOString()
    this.deps.appendMessage(team.id, {
      id: uuidv4(),
      teamId: team.id,
      from: 'ensemble',
      to: 'team',
      content: `👀 Watchdog nudged ${agentName}: ${WATCHDOG_NUDGE_TEXT}`,
      type: 'chat',
      timestamp,
    })

    const sessionName = `${team.name}-${agentName}`
    if (hostId && !this.deps.isSelf(hostId)) {
      const host = this.deps.getHostById(hostId)
      if (host) {
        await this.deps.postRemoteSessionCommand(host.url, sessionName, WATCHDOG_NUDGE_TEXT)
      }
      return
    }

    // Always use pasteFromFile to avoid shell escaping issues with sendKeys
    const runtime = this.deps.getRuntime()
    const filePath = this.deps.collabDeliveryFile(team.id, sessionName)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, WATCHDOG_NUDGE_TEXT)
    await runtime.pasteFromFile(sessionName, filePath)
  }
}

export { DEFAULT_POLL_INTERVAL_MS, DEFAULT_NUDGE_MS, DEFAULT_STALL_MS, WATCHDOG_NUDGE_TEXT }
