# Ensemble Web UI — Phase 1 Design Spec

## Goal

A local web app at `localhost:23000/ui` that shows running teams and lets you see and interact with agents in real-time — like having Claude Code and Codex open side by side with full terminal interactivity.

## Phase 1 Scope

**In scope:**
- Team sidebar (list, switch between teams)
- 2-agent side-by-side fully interactive terminal panels (xterm.js)
- Bottom input bar for team-say style messages
- Works with `eng-duo` template (Tech Lead + Lead Critic)

**Out of scope (Phase 2+):**
- Team creation from UI
- 3+ agent tabbed/stacked layout
- Desktop/sound notifications
- macOS DMG app
- Resizable/draggable panels
- Network access (localhost only for now)

## Architecture

```
Browser (localhost:23000/ui)
    │
    ├── GET /ui              → serves static HTML/JS/CSS from ui/ directory
    ├── GET /api/ensemble/teams  → team list (existing REST API)
    │
    └── WebSocket /ws/terminal/:teamId/:agentName
            │
            Server: node-pty spawns `tmux attach -t <sessionName>`
            │
            ├── PTY stdout → WebSocket → xterm.js (renders in browser)
            └── xterm.js keypress → WebSocket → PTY stdin (sent to tmux)
```

## Layout

```
┌──────────┬───────────────────────────┬────────────────────────────┐
│          │                           │                            │
│  TEAMS   │       TECH LEAD           │       LEAD CRITIC          │
│          │                           │                            │
│  ● team-1│   fully interactive       │   fully interactive        │
│  ○ team-2│   terminal (xterm.js)     │   terminal (xterm.js)      │
│  ○ team-3│                           │                            │
│          │   click to focus,         │   click to focus,          │
│          │   type to interact        │   type to interact         │
│          │                           │                            │
├──────────┴───────────────────────────┴────────────────────────────┤
│  [tech-lead ▼]  Type a message...                        [Send]  │
└───────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Team Sidebar

- Lists all teams from `GET /api/ensemble/teams`
- Shows status: green dot = active, gray = disbanded/completed
- Click to switch — terminal panels reconnect to the selected team's agents
- Polls every 5s for new teams (or newly spawned agents)
- Active team highlighted with accent color
- Shows team name (truncated) and agent count

### 2. Agent Terminal Panels

- Each panel is an xterm.js instance connected via WebSocket to `/ws/terminal/:teamId/:agentName`
- Server-side: `node-pty` spawns `tmux attach -t <team-name>-<agent-name>`
- Full bidirectional I/O: PTY output → WebSocket → xterm.js render; xterm.js input → WebSocket → PTY stdin
- Click a panel to focus — only focused panel receives keyboard input
- Focused panel gets highlighted border (accent color)
- Panel header shows: agent name, program (claude/codex), status indicator
- Auto-resize: xterm-addon-fit resizes terminal to match panel dimensions
- States:
  - **Connecting**: "Connecting to tech-lead..." spinner
  - **Live**: terminal streaming, bordered
  - **Session ended**: "Session ended" message (agent exited or team disbanded)
  - **No session**: "Waiting for agent to spawn..." (team created but agents not yet ready)

### 3. Bottom Input Bar

- Dropdown selector: choose target agent by name, or "team" for broadcast
- Text input field
- Send button (+ Enter to send)
- Sends via `POST /api/ensemble/teams/:teamId` (existing message endpoint)
- This is for team-say style steering messages, NOT for terminal interaction
- Clears after send, shows brief confirmation

## Server Changes

### WebSocket Terminal Proxy (`lib/terminal-proxy.ts`)

New module that manages PTY connections:

```
TerminalProxy
  ├── attach(teamName, agentName) → spawns node-pty with `tmux attach -t <session>`
  ├── write(data) → sends input to PTY stdin
  ├── onData(callback) → receives PTY stdout
  ├── resize(cols, rows) → resizes PTY
  └── kill() → cleans up PTY process
```

- One PTY per WebSocket connection
- When WebSocket closes, PTY process is killed
- When PTY exits (tmux session dies), WebSocket is closed with reason
- Handles tmux session not found gracefully (returns error message)

### Server Integration (`server.ts`)

- Add `ws` WebSocket server attached to the existing HTTP server
- Route: upgrade requests at `/ws/terminal/:teamId/:agentName`
- Extract teamId + agentName from URL, look up team to get session name
- Spawn TerminalProxy, wire bidirectional data flow
- Serve static files from `ui/` directory at `/ui` path

### Static File Serving

- `GET /ui` → `ui/index.html`
- `GET /ui/*` → static files from `ui/` directory

## Frontend

### Tech Stack

- Vanilla HTML/JS/CSS — no build step, no framework
- xterm.js loaded from node_modules or CDN
- xterm-addon-fit for auto-resize
- Native fetch for REST API
- Native WebSocket for terminal connections

### `ui/index.html`

Single-page layout:
- CSS Grid for the main layout (sidebar + 2 panels + input bar)
- Dark theme (matches terminal aesthetic)
- Responsive: panels share available width equally

### `ui/app.js`

Frontend logic:
- `TeamSidebar` — fetches teams, renders list, handles selection
- `TerminalPanel` — creates xterm.js instance, manages WebSocket lifecycle
- `InputBar` — message targeting + send
- `App` — orchestrates: when team selected, creates/destroys terminal panels

## Files

| File | Action | Purpose |
|---|---|---|
| `ui/index.html` | Create | Main page — layout, styles, inline or linked scripts |
| `ui/app.js` | Create | Frontend logic |
| `lib/terminal-proxy.ts` | Create | Server-side PTY management |
| `server.ts` | Modify | Add WebSocket handler + static file serving |
| `package.json` | Modify | Add ws, node-pty dependencies |

## Connection Lifecycle

1. User opens `localhost:23000/ui`
2. Frontend fetches `GET /api/ensemble/teams`, renders sidebar
3. Auto-selects first active team (or user clicks one)
4. Frontend opens 2 WebSocket connections to `/ws/terminal/:teamId/tech-lead` and `/ws/terminal/:teamId/lead-critic`
5. Server looks up team, resolves session names (`<team-name>-tech-lead`, `<team-name>-lead-critic`)
6. Server spawns node-pty: `tmux attach -t <sessionName>` for each
7. Bidirectional streaming begins — user sees live terminal output
8. User clicks a panel to focus, types directly — input goes through
9. When user switches teams: old WebSockets close (PTYs killed), new ones open
10. When agent's tmux session dies: PTY exits → WebSocket closes → panel shows "Session ended"
11. When new team is created via terminal (`ens-duo`): sidebar poll picks it up in ≤5s

## Styling

- Dark background (#1a1a2e or similar) — matches terminal feel
- Sidebar: slightly lighter background, team items as cards
- Terminal panels: black background, no border when unfocused, accent border when focused
- Panel headers: agent name in bold, program badge (colored), status dot
- Input bar: dark with subtle border, full width
- Font: system monospace for terminals, system sans for UI elements

## Critic Validation

Design validated through 1 round of adversarial critique (GPT-5.4 via Codex):
- PAUSE at confidence 8/10
- Critical findings addressed: feasibility spike approach validated (tmux attach via node-pty is standard pattern), layout simplified to 2-agent for Phase 1, replacement vs coexistence decided (coexist — terminal monitor stays)
- Phase boundary defined: team creation, 3+ agents, notifications, native app all deferred
