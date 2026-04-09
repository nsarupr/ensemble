# Ensemble Web UI — Phase 2 Design Spec

## Goal

Add team creation from the UI and support for 3+ agent layouts with a tabbed right panel.

## Scope

**In scope:**
- Team creation UI: template picker (eng-duo, eng-research, eng-fix), task input, launch button
- 3+ agent layout: Tech Lead + Critic always pinned side by side, additional agents in a tabbed right panel
- Dynamic layout: 2-agent mode (no right panel) vs 3-agent (right panel, no tabs) vs 4+ agent (right panel with tabs)

**Out of scope:**
- macOS DMG app
- Desktop notifications
- Other templates beyond duo/research/fix
- Resizable panels

## Team Creation

### UI Location

Sidebar split: scrollable team list on top, pinned "New Team" form at bottom.

```
┌──────────┐
│ TEAMS    │
│          │
│ ● team-1 │ ← scrollable
│ ○ team-2 │
│ ○ team-3 │
│          │
│══════════│ ← divider
│ NEW TEAM │ ← pinned at bottom
│          │
│ Template: │
│ [eng-duo▼]│
│          │
│ Task:     │
│ [........]│
│ [........]│
│          │
│ [Launch]  │
└──────────┘
```

### Components

- **Template dropdown**: eng-duo ("Duo — 2 agents"), eng-research ("Research — 4 agents"), eng-fix ("Bug Fix — 5 agents")
- **Task textarea**: multiline, 3 rows, placeholder "Describe the task..."
- **Launch button**: accent color, full width
  - On click: disable button, show "Launching..." text
  - POST to `/api/ensemble/teams` with templateName + description + workingDirectory
  - On success: auto-select the new team, reset form, re-enable button
  - On error: show error message inline below button (red text), re-enable button
  - Button stays disabled during submission to prevent duplicates

### API

**Existing:** `POST /api/ensemble/teams` with `templateName` — auto-derives agents (implemented in Session 1).

**New endpoint:** `GET /api/v1/cwd` — returns `{ "cwd": "<server process.cwd()>" }`. The UI calls this once on load to get the working directory for team creation.

### Team name generation

Frontend generates: `collab-<timestamp>-<random4digits>` (same pattern as collab-launch.sh).

## Layout

### Key design rule

**Tech Lead and Lead Critic are always-visible pinned panels. They are NOT tabs.** Only agents beyond these two go into the right panel.

**Agent placement is role-based, not positional.** Find `tech-lead` by name → left panel. Find `lead-critic` by name → middle panel. Everything else → right panel.

### 2-agent mode (eng-duo)

```
┌──────────┬───────────────────────┬────────────────────────┐
│ SIDEBAR  │     TECH LEAD         │     LEAD CRITIC        │
│          │     (50%)             │     (50%)              │
└──────────┴───────────────────────┴────────────────────────┘
│                    input bar                               │
└────────────────────────────────────────────────────────────┘
```

Grid: `var(--sidebar-width) 1fr 1fr`

No right panel. Same as Phase 1.

### 3-agent mode

```
┌──────────┬───────────────┬────────────────┬─────────────────┐
│ SIDEBAR  │  TECH LEAD    │  LEAD CRITIC   │   agent-3       │
│          │               │                │   (no tabs,     │
│          │               │                │    single term)  │
└──────────┴───────────────┴────────────────┴─────────────────┘
│                         input bar                            │
└──────────────────────────────────────────────────────────────┘
```

Grid: `var(--sidebar-width) 1fr 1fr 0.85fr`

Right panel has one terminal, no tab bar needed.

### 4-5 agent mode (eng-research, eng-fix)

```
┌──────────┬───────────────┬────────────────┬─────────────────┐
│ SIDEBAR  │  TECH LEAD    │  LEAD CRITIC   │ [tab1] [tab2].. │
│          │               │                │ ────────────     │
│          │               │                │ terminal of      │
│          │               │                │ active tab       │
└──────────┴───────────────┴────────────────┴─────────────────┘
│                         input bar                            │
└──────────────────────────────────────────────────────────────┘
```

Grid: `var(--sidebar-width) 1fr 1fr 0.85fr`

Tab bar at top of right panel. Active tab has accent underline.

### Tab Panel Behavior

- Tabs show agent names: e.g., `[researcher] [memory-keeper]`
- Active tab: accent bottom border, bright text
- Inactive tab: muted text, no border
- **All tab terminals stay connected in background** — toggle CSS visibility/display on switch. No WebSocket reconnection on tab change.
- Tab order matches agent order from template (after tech-lead and lead-critic)
- Click to focus: keyboard input goes to the focused terminal (any panel, including tabs)

### Layout Switching

When a team is selected:
1. Find `tech-lead` and `lead-critic` agents by name → assign to left/middle panels
2. Remaining agents → right panel
3. Count remaining: 0 → hide right panel (2-col grid), 1 → show right panel no tabs (3-col grid), 2+ → show right panel with tabs (3-col grid)
4. CSS grid columns updated dynamically via JS

## Files to Modify

| File | Changes |
|---|---|
| `ui/index.html` | Add new-team form (pinned bottom of sidebar), add right panel with tab bar, update CSS for dynamic grid + scrollable sidebar |
| `ui/app.js` | Add team creation, cwd fetch, tab management, dynamic layout switching, role-based agent placement, multi-terminal lifecycle |
| `server.ts` | Add `GET /api/v1/cwd` endpoint |

## Connection Lifecycle for 3+ Agents

1. User selects/creates a team
2. Frontend finds tech-lead → left panel WebSocket, lead-critic → middle panel WebSocket
3. Remaining agents: create ALL WebSocket connections upfront (all terminals connected)
4. Right panel shows first extra agent's terminal by default
5. Tab click toggles visibility (CSS display:none/block) — no WS close/open
6. When user switches teams: ALL WebSocket connections close, all terminals disposed, new ones created
7. When agent's tmux session dies: that panel/tab shows "Session ended"

## Styling

- Sidebar: team list scrollable (`overflow-y: auto`), new-team form pinned at bottom with top border
- Tab bar: `var(--bg-secondary)` background, horizontal flex, tabs as inline items
- Active tab: `var(--accent)` bottom border (2px), `var(--text-primary)` text
- Inactive tab: no border, `var(--text-muted)` text, hover brightens
- Right panel: same dark terminal background as primary panels
- Launch button: `var(--accent)` background, full width, disabled state dims to 50% opacity
- Error text: `var(--accent-red)`, 11px, below launch button
- Template dropdown + textarea: match existing input styling from input bar

## Critic Findings Addressed

- 3-agent case: explicit layout (right panel, no tabs)
- "Own tabs" ambiguity: resolved — Tech Lead and Lead Critic are pinned, NOT tabs
- Tab reconnection: all terminals stay connected, toggle visibility
- Team creation loading/error states: defined (disable button, inline error)
- Sidebar overflow: scrollable team list, pinned form
- Agent ordering: role-based placement by name, not positional
- `GET /api/v1/cwd` purpose: documented (UI needs it for workingDirectory in team creation POST)
