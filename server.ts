/**
 * Ensemble Server — Standalone HTTP server
 * Lightweight replacement for Next.js API routes.
 */

import http from 'http'
import {
  createEnsembleTeam, getEnsembleTeam, listEnsembleTeams,
  getTeamFeed, sendTeamMessage, disbandTeam,
} from './services/ensemble-service'
import { WebSocketServer, WebSocket } from 'ws'
import { attachToSession, type TerminalSession } from './lib/terminal-proxy'
import fs from 'fs'
import pathModule from 'path'
import { fileURLToPath } from 'url'

const __dirname = pathModule.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.ENSEMBLE_PORT || process.env.ORCHESTRA_PORT || '23000', 10)
const HOST = process.env.ENSEMBLE_HOST || '127.0.0.1'
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 100
const DEFAULT_CORS_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^http:\/\/\[::1\](?::\d+)?$/i,
]

type RateLimitEntry = {
  count: number
  windowStart: number
}

const rateLimitByIp = new Map<string, RateLimitEntry>()

// Periodic cleanup of stale rate limit entries to prevent unbounded Map growth
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitByIp) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitByIp.delete(ip)
    }
  }
}, 60_000)

function getAllowedCorsOrigins(): string[] {
  const configured = process.env.ENSEMBLE_CORS_ORIGIN?.trim()
  if (!configured) return []

  return configured
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

function isAllowedOrigin(origin: string): boolean {
  const configuredOrigins = getAllowedCorsOrigins()
  if (configuredOrigins.length > 0) return configuredOrigins.includes(origin)
  return DEFAULT_CORS_ORIGIN_PATTERNS.some(pattern => pattern.test(origin))
}

function buildCorsHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }

  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }

  return headers
}

function json(res: http.ServerResponse, data: unknown, status = 200, origin?: string) {
  res.writeHead(status, buildCorsHeaders(origin))
  res.end(JSON.stringify(data))
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function getClientIp(req: http.IncomingMessage): string {
  const forwardedFor = req.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string') {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  return req.socket.remoteAddress || 'unknown'
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const current = rateLimitByIp.get(ip)

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitByIp.set(ip, { count: 1, windowStart: now })
    return false
  }

  current.count += 1
  return current.count > RATE_LIMIT_MAX_REQUESTS
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const method = req.method || 'GET'
  const origin = req.headers.origin

  if (origin && !isAllowedOrigin(origin)) {
    return json(res, { error: 'CORS origin forbidden' }, 403, origin)
  }

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, buildCorsHeaders(origin))
    res.end()
    return
  }

  if (isRateLimited(getClientIp(req))) {
    return json(res, { error: 'Rate limit exceeded' }, 429, origin)
  }

  try {
    // Health check
    if (path === '/api/v1/health') {
      return json(res, { status: 'healthy', version: '1.0.0' }, 200, origin)
    }

    // Working directory (for UI team creation)
    if (path === '/api/v1/cwd') {
      return json(res, { cwd: process.cwd() }, 200, origin)
    }

    // Folder picker — opens native macOS dialog, returns selected path
    if (path === '/api/v1/pick-folder') {
      try {
        const { execSync } = await import('child_process')
        const script = 'tell application "System Events" to set frontApp to name of first process whose frontmost is true\n' +
          'set chosenFolder to POSIX path of (choose folder with prompt "Select working directory")\n' +
          'tell application frontApp to activate\n' +
          'return chosenFolder'
        const result = execSync(`osascript -e '${script}'`, { encoding: 'utf8', timeout: 60000 }).trim()
        // Remove trailing slash if present
        const folder = result.endsWith('/') ? result.slice(0, -1) : result
        return json(res, { folder }, 200, origin)
      } catch {
        return json(res, { folder: '', cancelled: true }, 200, origin)
      }
    }

    // List teams / Create team
    if (path === '/api/ensemble/teams') {
      if (method === 'GET') {
        const result = listEnsembleTeams()
        return json(res, result.data, result.status, origin)
      }
      if (method === 'POST') {
        let body: unknown
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          return json(res, { error: 'Bad Request: malformed JSON' }, 400, origin)
        }
        const result = await createEnsembleTeam(body as Parameters<typeof createEnsembleTeam>[0])
        if (result.error) return json(res, { error: result.error }, result.status, origin)
        return json(res, result.data, result.status, origin)
      }
    }

    // Team operations: /api/ensemble/teams/:id
    const teamMatch = path.match(/^\/api\/ensemble\/teams\/([^/]+)$/)
    if (teamMatch) {
      const teamId = teamMatch[1]
      if (method === 'GET') {
        const result = getEnsembleTeam(teamId)
        if (result.error) return json(res, { error: result.error }, result.status, origin)
        return json(res, result.data, result.status, origin)
      }
      if (method === 'POST') {
        let body: Record<string, unknown>
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          return json(res, { error: 'Bad Request: malformed JSON' }, 400, origin)
        }
        const result = await sendTeamMessage(teamId, (body.to as string) || 'team', body.content as string, body.from as string, body.id as string, body.timestamp as string)
        if (result.error) return json(res, { error: result.error }, result.status, origin)
        return json(res, result.data, result.status, origin)
      }
      if (method === 'DELETE') {
        const result = await disbandTeam(teamId)
        if (result.error) return json(res, { error: result.error }, result.status, origin)
        return json(res, result.data, result.status, origin)
      }
    }

    // Disband: /api/ensemble/teams/:id/disband
    const disbandMatch = path.match(/^\/api\/ensemble\/teams\/([^/]+)\/disband$/)
    if (disbandMatch && method === 'POST') {
      const result = await disbandTeam(disbandMatch[1])
      if (result.error) return json(res, { error: result.error }, result.status, origin)
      return json(res, result.data, result.status, origin)
    }

    // Resume: /api/ensemble/teams/:id/resume — creates a new team resuming sessions from a disbanded team
    const resumeMatch = path.match(/^\/api\/ensemble\/teams\/([^/]+)\/resume$/)
    if (resumeMatch && method === 'POST') {
      const oldTeamId = resumeMatch[1]
      const oldTeamResult = getEnsembleTeam(oldTeamId)
      if (oldTeamResult.error || !oldTeamResult.data) {
        return json(res, { error: 'Team not found' }, 404, origin)
      }
      const oldTeam = oldTeamResult.data.team
      // Build a new team request reusing the old config
      const newRequest = {
        name: `${oldTeam.name}-resumed`,
        description: oldTeam.description,
        agents: oldTeam.agents.map((a: { program: string; role: string; hostId: string }) => ({
          program: a.program,
          role: a.role,
          hostId: a.hostId,
        })),
        feedMode: oldTeam.feedMode,
        workingDirectory: path ? undefined : undefined, // will use server cwd
        resumeFrom: oldTeamId,
      }
      // Try to get working directory from the request body
      try {
        const body = JSON.parse(await readBody(req))
        if (body.workingDirectory) (newRequest as Record<string, unknown>).workingDirectory = body.workingDirectory
      } catch { /* no body, use defaults */ }
      const result = await createEnsembleTeam(newRequest as Parameters<typeof createEnsembleTeam>[0])
      if (result.error) return json(res, { error: result.error }, result.status, origin)
      return json(res, result.data, result.status, origin)
    }

    // Feed: /api/ensemble/teams/:id/feed
    const feedMatch = path.match(/^\/api\/ensemble\/teams\/([^/]+)\/feed$/)
    if (feedMatch && method === 'GET') {
      const since = url.searchParams.get('since') || undefined
      const result = getTeamFeed(feedMatch[1], since)
      if (result.error) return json(res, { error: result.error }, result.status, origin)
      return json(res, result.data, result.status, origin)
    }

    // Static UI files: /ui, /ui/*, /ui/node_modules/*
    if (path === '/ui' || path === '/ui/') {
      const indexPath = pathModule.join(__dirname, 'ui', 'index.html')
      try {
        const content = fs.readFileSync(indexPath, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(content)
        return
      } catch {
        return json(res, { error: 'UI not found' }, 404, origin)
      }
    }

    if (path.startsWith('/ui/')) {
      const relativePath = path.slice(4)
      let filePath: string
      if (relativePath.startsWith('node_modules/')) {
        filePath = pathModule.join(__dirname, relativePath)
      } else {
        filePath = pathModule.join(__dirname, 'ui', relativePath)
      }

      const resolved = pathModule.resolve(filePath)
      const allowedDirs = [
        pathModule.resolve(pathModule.join(__dirname, 'ui')),
        pathModule.resolve(pathModule.join(__dirname, 'node_modules')),
      ]
      if (!allowedDirs.some(dir => resolved.startsWith(dir))) {
        return json(res, { error: 'Forbidden' }, 403, origin)
      }

      try {
        const content = fs.readFileSync(resolved)
        const ext = pathModule.extname(resolved)
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
          '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
          '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
        res.end(content)
        return
      } catch {
        return json(res, { error: 'Not found' }, 404, origin)
      }
    }

    json(res, { error: 'Not found' }, 404, origin)
  } catch (err) {
    console.error('[Server] Error:', err)
    json(res, { error: 'Internal server error' }, 500, origin)
  }
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Ensemble] Port ${PORT} is already in use on ${HOST}. Stop the other process or set ENSEMBLE_PORT to a different port.`)
    process.exit(1)
  }

  console.error('[Ensemble] Server failed to start:', err)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`[Ensemble] Server running on http://${HOST}:${PORT}`)
  console.log(`[Ensemble] Web UI: http://localhost:${PORT}/ui`)
  console.log(`[Ensemble] Health: http://localhost:${PORT}/api/v1/health`)
})

// ─── WebSocket Terminal Proxy ─────────────────────────────────────
const wss = new WebSocketServer({ noServer: true })
const activeSessions = new Map<WebSocket, TerminalSession>()

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const wsPath = url.pathname

  const match = wsPath.match(/^\/ws\/terminal\/([^/]+)\/([^/]+)$/)
  if (!match) {
    socket.destroy()
    return
  }

  const teamId = match[1]
  const agentName = match[2]

  const teamResult = getEnsembleTeam(teamId)
  if (teamResult.error || !teamResult.data) {
    socket.destroy()
    return
  }

  const team = teamResult.data.team
  const agent = team.agents.find((a: { name: string }) => a.name === agentName)
  if (!agent) {
    socket.destroy()
    return
  }

  const sessionName = `${team.name}-${agent.name}`

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)

    let terminal: TerminalSession
    try {
      const cols = parseInt(url.searchParams.get('cols') || '120', 10)
      const rows = parseInt(url.searchParams.get('rows') || '40', 10)
      terminal = attachToSession(sessionName, cols, rows)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      ws.send(JSON.stringify({ type: 'error', message: `Failed to attach: ${reason}` }))
      ws.close()
      return
    }

    activeSessions.set(ws, terminal)

    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    terminal.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', message: 'Session ended' }))
        ws.close()
      }
      activeSessions.delete(ws)
    })

    ws.on('message', (msg) => {
      const data = msg.toString()
      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          terminal.resize(parsed.cols, parsed.rows)
          return
        }
        if (parsed.type === 'input') {
          terminal.write(parsed.data)
          return
        }
      } catch {
        terminal.write(data)
      }
    })

    ws.on('close', () => {
      terminal.kill()
      activeSessions.delete(ws)
    })

    ws.on('error', () => {
      terminal.kill()
      activeSessions.delete(ws)
    })
  })
})

process.on('SIGINT', () => {
  for (const [, session] of activeSessions) {
    session.kill()
  }
})
