/**
 * Terminal Proxy — Attaches to agent tmux sessions via node-pty
 * Provides bidirectional PTY I/O for xterm.js WebSocket connections.
 */

import * as pty from 'node-pty'
import { execSync } from 'child_process'

/** Resolve full path to tmux — node-pty may not inherit the shell's PATH */
function findTmux(): string {
  try {
    return execSync('which tmux', { encoding: 'utf8' }).trim()
  } catch {
    // Common locations
    for (const p of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux']) {
      try {
        execSync(`${p} -V`, { encoding: 'utf8' })
        return p
      } catch { /* not here */ }
    }
    return 'tmux' // fallback — let node-pty try PATH
  }
}

const TMUX_PATH = findTmux()

export interface TerminalSession {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  onData(callback: (data: string) => void): void
  onExit(callback: (exitCode: number, signal: number) => void): void
  kill(): void
}

export function attachToSession(sessionName: string, cols = 120, rows = 40): TerminalSession {
  // Enable mouse mode so xterm.js wheel events scroll tmux history
  try {
    execSync(`${TMUX_PATH} set-option -t "${sessionName}" mouse on 2>/dev/null`, { timeout: 3000 })
  } catch { /* session may not support it — proceed anyway */ }

  const proc = pty.spawn(TMUX_PATH, ['attach', '-t', sessionName], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  })

  const dataCallbacks: Array<(data: string) => void> = []
  const exitCallbacks: Array<(code: number, signal: number) => void> = []

  proc.onData((data) => {
    for (const cb of dataCallbacks) cb(data)
  })

  proc.onExit(({ exitCode, signal }) => {
    for (const cb of exitCallbacks) cb(exitCode, signal ?? 0)
  })

  return {
    pid: proc.pid,
    write: (data: string) => proc.write(data),
    resize: (cols: number, rows: number) => proc.resize(cols, rows),
    onData: (cb) => { dataCallbacks.push(cb) },
    onExit: (cb) => { exitCallbacks.push(cb) },
    kill: () => proc.kill(),
  }
}
