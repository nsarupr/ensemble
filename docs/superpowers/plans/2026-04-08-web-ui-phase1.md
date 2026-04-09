# Ensemble Web UI Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web UI at `localhost:23000/ui` with side-by-side interactive terminal panels for 2 agents, a team sidebar, and an input bar.

**Architecture:** Existing HTTP server gets WebSocket support (ws library) and static file serving. Each agent panel is an xterm.js terminal emulator connected via WebSocket to a node-pty process that runs `tmux attach -t <session>`. Frontend is vanilla HTML/JS/CSS — no build step.

**Tech Stack:** node-pty, ws, xterm.js, xterm-addon-fit, vanilla HTML/JS/CSS

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/terminal-proxy.ts` | Create | Server-side PTY lifecycle: spawn `tmux attach`, pipe I/O, resize, cleanup |
| `server.ts` | Modify | Add WebSocket upgrade handler for `/ws/terminal/`, static file serving for `/ui` |
| `ui/index.html` | Create | Main page: layout (CSS grid), styles (dark theme), script imports |
| `ui/app.js` | Create | Frontend logic: team sidebar, terminal panel management, input bar |
| `package.json` | Modify | Add ws, node-pty as dependencies |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install ws and node-pty**

```bash
cd /Users/nileshsarupriya/Orchestrator/ensemble
npm install ws node-pty
npm install --save-dev @types/ws
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('node-pty'); require('ws'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Verify existing tests still pass**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add ws and node-pty for web UI terminal proxy"
```

---

### Task 2: Create terminal proxy module

**Files:**
- Create: `lib/terminal-proxy.ts`

- [ ] **Step 1: Create lib/terminal-proxy.ts**

```typescript
/**
 * Terminal Proxy — Attaches to agent tmux sessions via node-pty
 * Provides bidirectional PTY I/O for xterm.js WebSocket connections.
 */

import * as pty from 'node-pty'

export interface TerminalSession {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  onData(callback: (data: string) => void): void
  onExit(callback: (exitCode: number, signal: number) => void): void
  kill(): void
}

/**
 * Attach to an existing tmux session by name.
 * Spawns a PTY running `tmux attach -t <sessionName>`.
 * Returns a TerminalSession for bidirectional I/O.
 */
export function attachToSession(sessionName: string, cols = 120, rows = 40): TerminalSession {
  const proc = pty.spawn('tmux', ['attach', '-t', sessionName], {
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
    for (const cb of exitCallbacks) cb(exitCode, signal)
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Quick manual test**

```bash
# Start a test tmux session
tmux new-session -d -s test-proxy "echo hello; sleep 300"

# Test that node-pty can attach
node --loader tsx -e "
import { attachToSession } from './lib/terminal-proxy.ts';
const s = attachToSession('test-proxy');
s.onData(d => process.stdout.write(d));
s.onExit(() => { console.log('exited'); process.exit(0); });
setTimeout(() => { s.kill(); process.exit(0); }, 2000);
"

# Cleanup
tmux kill-session -t test-proxy
```

Expected: see tmux session output for 2 seconds, then exit cleanly

- [ ] **Step 4: Commit**

```bash
git add lib/terminal-proxy.ts
git commit -m "feat: add terminal-proxy module for PTY attachment to tmux sessions"
```

---

### Task 3: Add WebSocket handler and static serving to server

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Add imports and WebSocket server setup at the top of server.ts**

After the existing imports, add:

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import { attachToSession, type TerminalSession } from './lib/terminal-proxy'
import fs from 'fs'
import pathModule from 'path'
import { fileURLToPath } from 'url'

const __dirname = pathModule.dirname(fileURLToPath(import.meta.url))
```

- [ ] **Step 2: Add static file serving inside the request handler**

Before the `json(res, { error: 'Not found' }, 404, origin)` line (line ~197), add:

```typescript
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
      const relativePath = path.slice(4) // strip /ui/
      // Allow serving from ui/ directory and node_modules/ for xterm
      let filePath: string
      if (relativePath.startsWith('node_modules/')) {
        filePath = pathModule.join(__dirname, relativePath)
      } else {
        filePath = pathModule.join(__dirname, 'ui', relativePath)
      }

      // Prevent directory traversal
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
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.mjs': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.map': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' })
        res.end(content)
        return
      } catch {
        return json(res, { error: 'Not found' }, 404, origin)
      }
    }
```

- [ ] **Step 3: Add WebSocket upgrade handler after the server.listen block**

After the `server.listen(...)` block, add:

```typescript
// ─── WebSocket Terminal Proxy ─────────────────────────────────────
const wss = new WebSocketServer({ noServer: true })

// Track active terminal sessions for cleanup
const activeSessions = new Map<WebSocket, TerminalSession>()

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const wsPath = url.pathname

  // Match: /ws/terminal/:teamId/:agentName
  const match = wsPath.match(/^\/ws\/terminal\/([^/]+)\/([^/]+)$/)
  if (!match) {
    socket.destroy()
    return
  }

  const teamId = match[1]
  const agentName = match[2]

  // Look up team to get the tmux session name
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

    // PTY output → WebSocket
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    // PTY exit → close WebSocket
    terminal.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', message: 'Session ended' }))
        ws.close()
      }
      activeSessions.delete(ws)
    })

    // WebSocket messages → PTY input
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
        // Not JSON — treat as raw terminal input
        terminal.write(data)
      }
    })

    // WebSocket close → kill PTY
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

// Cleanup all PTY sessions on server shutdown
process.on('SIGINT', () => {
  for (const [, session] of activeSessions) {
    session.kill()
  }
})
```

- [ ] **Step 4: Update the server startup log**

Change the server.listen callback to:

```typescript
server.listen(PORT, HOST, () => {
  console.log(`[Ensemble] Server running on http://${HOST}:${PORT}`)
  console.log(`[Ensemble] Web UI: http://localhost:${PORT}/ui`)
  console.log(`[Ensemble] Health: http://localhost:${PORT}/api/v1/health`)
})
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: add WebSocket terminal proxy and static file serving for web UI"
```

---

### Task 4: Create the frontend — HTML layout and styles

**Files:**
- Create: `ui/index.html`

- [ ] **Step 1: Create ui/ directory**

```bash
mkdir -p /Users/nileshsarupriya/Orchestrator/ensemble/ui
```

- [ ] **Step 2: Create ui/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ensemble</title>
  <link rel="stylesheet" href="/ui/node_modules/@xterm/xterm/css/xterm.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --text-muted: #484f58;
      --accent: #58a6ff;
      --accent-green: #3fb950;
      --accent-red: #f85149;
      --accent-yellow: #d29922;
      --sidebar-width: 220px;
      --inputbar-height: 56px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
    }

    /* ─── Grid Layout ─── */
    #app {
      display: grid;
      grid-template-columns: var(--sidebar-width) 1fr 1fr;
      grid-template-rows: 1fr var(--inputbar-height);
      grid-template-areas:
        "sidebar panel-left panel-right"
        "sidebar inputbar inputbar";
      height: 100vh;
    }

    /* ─── Team Sidebar ─── */
    #sidebar {
      grid-area: sidebar;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    #sidebar-header {
      padding: 16px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
    }

    #sidebar-header span {
      font-size: 18px;
      color: var(--text-primary);
      display: block;
      margin-bottom: 2px;
      text-transform: none;
      letter-spacing: normal;
    }

    #team-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .team-item {
      padding: 10px 12px;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 4px;
      transition: background 0.15s;
    }

    .team-item:hover { background: var(--bg-tertiary); }
    .team-item.active { background: var(--bg-tertiary); border-left: 3px solid var(--accent); }

    .team-item .team-name {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .team-item .team-meta {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .team-item .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }

    .status-dot.active { background: var(--accent-green); }
    .status-dot.forming { background: var(--accent-yellow); }
    .status-dot.disbanded, .status-dot.completed { background: var(--text-muted); }

    /* ─── Terminal Panels ─── */
    .terminal-panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-right: 1px solid var(--border);
    }

    #panel-left { grid-area: panel-left; }
    #panel-right { grid-area: panel-right; border-right: none; }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      min-height: 36px;
    }

    .panel-header .agent-name {
      font-weight: 600;
    }

    .panel-header .agent-program {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
    }

    .panel-header .agent-status {
      margin-left: auto;
      font-size: 11px;
      color: var(--text-muted);
    }

    .panel-body {
      flex: 1;
      background: #000;
      position: relative;
    }

    .panel-body.focused {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }

    .panel-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      font-size: 14px;
    }

    /* ─── Input Bar ─── */
    #inputbar {
      grid-area: inputbar;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
    }

    #inputbar select {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 13px;
      outline: none;
    }

    #inputbar input {
      flex: 1;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 13px;
      outline: none;
    }

    #inputbar input:focus {
      border-color: var(--accent);
    }

    #inputbar button {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 6px 16px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
    }

    #inputbar button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div id="app">
    <!-- Sidebar -->
    <div id="sidebar">
      <div id="sidebar-header">
        <span>Ensemble</span>
        teams
      </div>
      <div id="team-list"></div>
    </div>

    <!-- Terminal Panels -->
    <div id="panel-left" class="terminal-panel">
      <div class="panel-header">
        <span class="agent-name" id="left-agent-name">—</span>
        <span class="agent-program" id="left-agent-program"></span>
        <span class="agent-status" id="left-agent-status"></span>
      </div>
      <div class="panel-body" id="left-terminal">
        <div class="panel-placeholder">Select a team to begin</div>
      </div>
    </div>

    <div id="panel-right" class="terminal-panel">
      <div class="panel-header">
        <span class="agent-name" id="right-agent-name">—</span>
        <span class="agent-program" id="right-agent-program"></span>
        <span class="agent-status" id="right-agent-status"></span>
      </div>
      <div class="panel-body" id="right-terminal">
        <div class="panel-placeholder">Select a team to begin</div>
      </div>
    </div>

    <!-- Input Bar -->
    <div id="inputbar">
      <select id="msg-target">
        <option value="team">team</option>
      </select>
      <input type="text" id="msg-input" placeholder="Send a message to the team..." />
      <button id="msg-send">Send</button>
    </div>
  </div>

  <script type="module" src="/ui/node_modules/@xterm/xterm/lib/xterm.js"></script>
  <script type="module" src="/ui/node_modules/@xterm/addon-fit/lib/addon-fit.js"></script>
  <script src="/ui/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add ui/index.html
git commit -m "feat: add web UI HTML layout with dark theme"
```

---

### Task 5: Create the frontend — app.js

**Files:**
- Create: `ui/app.js`

- [ ] **Step 1: Create ui/app.js**

```javascript
/**
 * Ensemble Web UI — Frontend Logic
 * Manages team sidebar, terminal panels (xterm.js), and input bar.
 */

const API_BASE = window.location.origin;

// ─── State ───
let teams = [];
let selectedTeamId = null;
let terminals = { left: null, right: null };
let websockets = { left: null, right: null };
let focusedPanel = null; // 'left' or 'right'

// ─── Team Sidebar ───

async function fetchTeams() {
  try {
    const res = await fetch(`${API_BASE}/api/ensemble/teams`);
    const data = await res.json();
    teams = data.teams || [];
    renderTeamList();
  } catch (err) {
    console.error('Failed to fetch teams:', err);
  }
}

function renderTeamList() {
  const list = document.getElementById('team-list');
  if (!list) return;

  list.innerHTML = teams.map(team => {
    const isActive = team.id === selectedTeamId;
    const statusClass = team.status || 'disbanded';
    const agentCount = team.agents?.length || 0;
    const desc = team.description
      ? team.description.slice(0, 50) + (team.description.length > 50 ? '...' : '')
      : '';

    return `
      <div class="team-item ${isActive ? 'active' : ''}"
           onclick="selectTeam('${team.id}')">
        <div class="team-name">
          <span class="status-dot ${statusClass}"></span>
          ${escapeHtml(team.name)}
        </div>
        <div class="team-meta">${agentCount} agents${desc ? ' — ' + escapeHtml(desc) : ''}</div>
      </div>
    `;
  }).join('');
}

function selectTeam(teamId) {
  if (selectedTeamId === teamId) return;
  selectedTeamId = teamId;

  // Cleanup old connections
  closeTerminals();

  const team = teams.find(t => t.id === teamId);
  if (!team || !team.agents || team.agents.length === 0) {
    showPlaceholder('left', 'Waiting for agents to spawn...');
    showPlaceholder('right', 'Waiting for agents to spawn...');
    updateHeaders(null, null);
    renderTeamList();
    return;
  }

  // First agent → left panel, second → right panel
  const leftAgent = team.agents[0] || null;
  const rightAgent = team.agents[1] || null;

  updateHeaders(leftAgent, rightAgent);
  updateTargetDropdown(team.agents);

  if (leftAgent) {
    connectTerminal('left', team.id, leftAgent);
  } else {
    showPlaceholder('left', 'No agent');
  }

  if (rightAgent) {
    connectTerminal('right', team.id, rightAgent);
  } else {
    showPlaceholder('right', 'No agent');
  }

  renderTeamList();
}

// ─── Terminal Panels ───

function connectTerminal(side, teamId, agent) {
  const containerId = side === 'left' ? 'left-terminal' : 'right-terminal';
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clear placeholder
  container.innerHTML = '';

  // Create xterm instance
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    theme: {
      background: '#000000',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
      selectionBackground: '#264f78',
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  terminals[side] = { term, fitAddon };

  // Focus handling
  container.addEventListener('click', () => setFocus(side));

  // WebSocket connection
  const cols = term.cols;
  const rows = term.rows;
  const wsUrl = `ws://${window.location.host}/ws/terminal/${teamId}/${agent.name}?cols=${cols}&rows=${rows}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateStatus(side, 'connected');
  };

  ws.onmessage = (event) => {
    const data = event.data;
    // Check if it's a JSON control message
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'error') {
        term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        return;
      }
      if (msg.type === 'exit') {
        term.write(`\r\n\x1b[90m${msg.message}\x1b[0m\r\n`);
        updateStatus(side, 'ended');
        return;
      }
    } catch {
      // Not JSON — raw terminal output
    }
    term.write(data);
  };

  ws.onclose = () => {
    updateStatus(side, 'disconnected');
  };

  ws.onerror = () => {
    updateStatus(side, 'error');
  };

  websockets[side] = ws;

  // Terminal input → WebSocket
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  });
  resizeObserver.observe(container);
}

function closeTerminals() {
  for (const side of ['left', 'right']) {
    if (websockets[side]) {
      websockets[side].close();
      websockets[side] = null;
    }
    if (terminals[side]) {
      terminals[side].term.dispose();
      terminals[side] = null;
    }
    showPlaceholder(side, 'Select a team to begin');
    updateStatus(side, '');
  }
}

function showPlaceholder(side, text) {
  const containerId = side === 'left' ? 'left-terminal' : 'right-terminal';
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<div class="panel-placeholder">${escapeHtml(text)}</div>`;
  }
}

function setFocus(side) {
  focusedPanel = side;
  document.getElementById('left-terminal')?.classList.toggle('focused', side === 'left');
  document.getElementById('right-terminal')?.classList.toggle('focused', side === 'right');

  // Focus the xterm instance so it captures keyboard input
  if (terminals[side]) {
    terminals[side].term.focus();
  }
}

// ─── Headers & Status ───

function updateHeaders(leftAgent, rightAgent) {
  document.getElementById('left-agent-name').textContent = leftAgent?.name || '—';
  document.getElementById('left-agent-program').textContent = leftAgent?.program || '';
  document.getElementById('left-agent-program').style.display = leftAgent ? '' : 'none';

  document.getElementById('right-agent-name').textContent = rightAgent?.name || '—';
  document.getElementById('right-agent-program').textContent = rightAgent?.program || '';
  document.getElementById('right-agent-program').style.display = rightAgent ? '' : 'none';
}

function updateStatus(side, status) {
  const el = document.getElementById(side === 'left' ? 'left-agent-status' : 'right-agent-status');
  if (!el) return;

  const labels = {
    connected: '● connected',
    disconnected: '○ disconnected',
    ended: '○ session ended',
    error: '● error',
    '': '',
  };
  const colors = {
    connected: '#3fb950',
    disconnected: '#484f58',
    ended: '#484f58',
    error: '#f85149',
    '': '',
  };

  el.textContent = labels[status] || status;
  el.style.color = colors[status] || '';
}

function updateTargetDropdown(agents) {
  const select = document.getElementById('msg-target');
  if (!select) return;

  select.innerHTML = '<option value="team">team</option>';
  for (const agent of agents) {
    const opt = document.createElement('option');
    opt.value = agent.name;
    opt.textContent = agent.name;
    select.appendChild(opt);
  }
}

// ─── Input Bar ───

async function sendMessage() {
  if (!selectedTeamId) return;

  const input = document.getElementById('msg-input');
  const target = document.getElementById('msg-target');
  const content = input.value.trim();
  if (!content) return;

  try {
    await fetch(`${API_BASE}/api/ensemble/teams/${selectedTeamId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'user',
        to: target.value,
        content,
      }),
    });
    input.value = '';
  } catch (err) {
    console.error('Failed to send message:', err);
  }
}

// ─── Utilities ───

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Initialization ───

document.addEventListener('DOMContentLoaded', () => {
  // Input bar events
  document.getElementById('msg-send')?.addEventListener('click', sendMessage);
  document.getElementById('msg-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Initial fetch + polling
  fetchTeams();
  setInterval(fetchTeams, 5000);

  // Auto-select first active team
  setTimeout(() => {
    const activeTeam = teams.find(t => t.status === 'active');
    if (activeTeam) selectTeam(activeTeam.id);
  }, 1000);

  // Re-check for agents if selected team has none
  setInterval(() => {
    if (!selectedTeamId) return;
    const team = teams.find(t => t.id === selectedTeamId);
    if (team && team.agents && team.agents.length > 0 && !terminals.left && !terminals.right) {
      selectTeam(selectedTeamId); // reconnect
    }
  }, 3000);
});
```

- [ ] **Step 2: Verify the xterm.js imports work**

The HTML loads xterm.js from node_modules. Verify the paths exist:

```bash
ls node_modules/@xterm/xterm/css/xterm.css node_modules/@xterm/xterm/lib/xterm.js node_modules/@xterm/addon-fit/lib/addon-fit.js 2>&1
```

If not found, the package names may differ. Check:

```bash
ls node_modules/ | grep -i xterm
```

If the package is `xterm` (not `@xterm/xterm`), update the import paths in index.html accordingly.

- [ ] **Step 3: Commit**

```bash
git add ui/app.js
git commit -m "feat: add web UI frontend logic — terminals, sidebar, input bar"
```

---

### Task 6: Install xterm.js frontend packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install xterm and fit addon**

```bash
npm install @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: Verify the CSS and JS files exist**

```bash
ls node_modules/@xterm/xterm/css/xterm.css
ls node_modules/@xterm/xterm/lib/xterm.js
ls node_modules/@xterm/addon-fit/lib/addon-fit.js
```

- [ ] **Step 3: Update the script tags in index.html if needed**

The xterm.js module may need to be loaded differently. Check the actual export:

```bash
head -5 node_modules/@xterm/xterm/lib/xterm.js
```

If it's an ES module, the script tags are fine. If it's CommonJS, switch to:

```html
<script src="/ui/node_modules/@xterm/xterm/lib/xterm.js"></script>
<script src="/ui/node_modules/@xterm/addon-fit/lib/addon-fit.js"></script>
```

(Remove `type="module"` if the files are UMD/IIFE bundles.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @xterm/xterm and @xterm/addon-fit for web UI"
```

---

### Task 7: End-to-end test

**Files:** None — manual testing

- [ ] **Step 1: Start the server**

```bash
pkill -f "tsx server.ts" 2>/dev/null
cd /Users/nileshsarupriya/Orchestrator/ensemble
npm run dev
```

- [ ] **Step 2: Open the UI**

Open `http://localhost:23000/ui` in a browser.

Expected: dark themed page with team sidebar (may be empty), two terminal panels showing "Select a team to begin", and an input bar.

- [ ] **Step 3: Create a test team**

In another terminal:

```bash
source ~/.zshrc
ens-duo "Hello, this is a test task. Just say hi to each other."
```

- [ ] **Step 4: Verify the UI**

- Sidebar should show the new team within 5 seconds
- Click the team — both panels should connect and show live terminal output
- Click into a panel — it should get a blue border (focused)
- Type in the focused panel — keystrokes should go to the agent
- If an agent shows a permission prompt, interact with it directly (arrow keys, Enter)
- Use the input bar to send a team message
- Verify the message appears in the agent's tmux session

- [ ] **Step 5: Verify existing tests still pass**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: TypeScript compiles, all tests pass

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: Ensemble web UI Phase 1 — interactive terminal panels, team sidebar"
```

---

## Self-Review

**Spec coverage check:**
- Team sidebar (list, switch): Task 5 (app.js fetchTeams, selectTeam, renderTeamList)
- 2-agent side-by-side terminals: Task 4 (HTML grid) + Task 5 (connectTerminal)
- Full interactivity: Task 2 (terminal-proxy) + Task 3 (WebSocket handler) + Task 5 (term.onData → ws.send)
- Bottom input bar: Task 4 (HTML) + Task 5 (sendMessage)
- Static file serving: Task 3 (server.ts)
- Connection lifecycle: Task 3 (WebSocket handler) + Task 5 (connectTerminal, closeTerminals)
- Dark theme: Task 4 (CSS)

**Placeholder scan:** No TBDs, TODOs, or vague steps. All code blocks are complete.

**Type consistency:** `attachToSession` returns `TerminalSession` in Task 2, consumed in Task 3. `connectTerminal(side, teamId, agent)` signature consistent between HTML and JS. WebSocket message protocol (`{type, data}`, `{type, cols, rows}`) matches server and client.
