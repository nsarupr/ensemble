# ensemble

**Multi-agent collaboration engine** — AI agents that work as one.

Ensemble orchestrates AI agents into collaborative teams. Out of the box it pairs **Claude Code + Codex** — they communicate, share findings, and solve problems together in real time. Built on tmux-based session management for transparent, observable agent interactions.

> **Status:** Experimental developer tool. macOS and Linux only.

## Features

- **Team orchestration** — Spawn multi-agent teams with a single command
- **Web UI** — Interactive terminal panels in your browser at `localhost:23000/ui`
- **Pre-built team templates** — Duo, Build, Fix, Research, Experiment, and more
- **Real-time messaging** — Agents communicate via a structured message bus
- **TUI monitor** — Watch agent collaboration live from your terminal
- **Prompt detection** — Surfaces when agents need input, respond directly from UI
- **Session resume** — Disband teams and resume conversations later
- **Shared memory** — Team knowledge base with temporal decay
- **Auto-disband** — Intelligent completion detection ends teams when work is done
- **Multi-host support** — Run agents across local and remote machines
- **CLI & HTTP API** — Full control via command line or REST endpoints

**[Full documentation →](https://michelhelsdingen.github.io/ensemble/)**

## Quick Start

### Prerequisites

- Node.js 18+, Python 3.6+, [tmux](https://github.com/tmux/tmux), curl
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Codex](https://github.com/openai/codex) CLIs installed

### Install & Run

```bash
git clone https://github.com/nsarupr/ensemble.git
cd ensemble
npm install

# Rebuild node-pty (required for Node v24+)
cd node_modules/node-pty && npx node-gyp rebuild && cd ../..

# Start the server
npm run dev
```

### Open the Web UI

```
http://localhost:23000/ui
```

Create a team from the sidebar — pick a template, type your task, hit Launch. Both agents appear as interactive terminal panels. Click into a panel to type directly.

### Or use the CLI

```bash
# Add to ~/.zshrc for shortcuts
export ENSEMBLE_HOME="$HOME/Orchestrator/ensemble"
alias ens='$ENSEMBLE_HOME/scripts/collab-launch.sh "$(pwd)"'
alias ens-duo='ens --template eng-duo'
alias ens-build='ens --template eng-build'
alias ens-fix='ens --template eng-fix'
alias ens-research='ens --template eng-research'

# Launch a duo team (Tech Lead + Lead Critic)
ens-duo "Add rate limiting to the API"

# Launch a build team (6 agents)
ens-build "Implement caching layer with Redis"

# Launch a bug fix team (5 agents)
ens-fix "Fix the race condition in batch processor"
```

## Web UI

The web UI at `localhost:23000/ui` gives you a full IDE-like experience:

```
┌──────────┬───────────────────┬────────────────────┬──────────────────┐
│          │                   │                    │  [researcher]    │
│  TEAMS   │    TECH LEAD      │    LEAD CRITIC     │  [memory]  ←tabs │
│          │                   │                    │                  │
│  ● team-1│    interactive     │    interactive     │  interactive     │
│  ○ team-2│    terminal        │    terminal        │  terminal        │
│          │                   │                    │                  │
├──────────┼───────────────────┴────────────────────┴──────────────────┤
│ NEW TEAM │                    input bar                              │
│ [Launch] │  [target ▼]  message...              [Send]   [Disband]  │
└──────────┴──────────────────────────────────────────────────────────-┘
```

- **Interactive terminals** — Each agent panel is a real terminal (xterm.js + WebSocket). Click to focus, type to interact. Respond to permission prompts directly.
- **Team sidebar** — List of all teams with status. Click to switch.
- **Team creation** — Pick a template, set working directory (with native folder picker), describe your task, launch.
- **Dynamic layout** — 2 agents: side by side. 3+ agents: two primary panels + tabbed right panel for extras.
- **Scroll history** — Mouse wheel scrolls through agent's terminal history (via tmux mouse mode).
- **Disband & Resume** — Disband stops all agents. Resume restarts them with `--resume` to continue the conversation.

## Team Templates

Pre-configured team compositions with role-specific system instructions:

| Template | Agents | Use case |
|---|---|---|
| `eng-duo` | Tech Lead + Lead Critic | Quick tasks, code + adversarial review |
| `eng-build` | TL + Critic + Architect + Dev + QA + Memory | Standard feature implementation |
| `eng-fix` | TL + Critic + Dev + QA + Memory | Bug investigation and fix |
| `eng-research` | TL + Critic + Researcher + Memory | Discovery and competitive analysis |
| `eng-review` | TL + Critic + Architect + Memory | Code review with critique |
| `eng-experiment` | TL + Critic + Researcher + Architect + QA + Report Gen + Stats + Memory | Research, benchmark, analyze |
| `eng-iterate` | TL + Critic + Dev + QA + Report Gen + Stats + Memory | Improve previous results |
| `eng-full` | All 10 agents | Full lifecycle: research to production |

### Agent Roster

| Agent | Runtime | Role |
|---|---|---|
| Tech Lead | Claude CLI | Orchestrator — plans, delegates, reviews, decides |
| Lead Critic | Codex | Adversarial reviewer — different model for cognitive diversity |
| Researcher | Claude CLI | Discovery, competitive analysis, evidence-backed briefs |
| Architect | Claude CLI | System design, interfaces, contracts, eval criteria |
| Developer | Codex | Python implementation |
| QA Engineer | Codex | Testing, eval harnesses, experiment execution |
| Report Generator | Claude CLI | Structures experiment output into reports |
| Stats Interpretive | Claude CLI | Trend analysis, narrative conclusions |
| Stats Computational | Codex | Statistical tests, significance, charts |
| Memory Keeper | Codex | Shared knowledge base with temporal decay |

## Shared Memory

Teams maintain a dual-scope knowledge base:

- **Team scope** (`/tmp/ensemble/<team-id>/working-memory/`) — session scratchpad, dies when team disbands
- **Project scope** (`.team-memory/`) — durable knowledge with 90-day temporal decay

Categories: mistakes, preferences, decisions, anti-patterns, learnings. Entries include evidence, tags, and automatic relevance scoring.

## How It Works

1. **Create a team** — Pick a template or define agents via API/CLI/Web UI
2. **Agents spawn** — Each gets a tmux session with role-specific system instructions
3. **Communication** — Agents use `team-say`/`team-read` to exchange messages
4. **Monitor** — Watch via Web UI (interactive terminals) or TUI monitor
5. **Critique loop** — Lead Critic reviews artifacts, returns STOP/PAUSE/PROCEED verdicts
6. **Resume** — Disband and resume later, picking up the conversation

## TUI Monitor

For terminal-only usage:

```bash
npx ensemble monitor --latest
```

Keybindings:

| Key | Action |
|---|---|
| `s` | Steer team (send message) |
| `1-N` | Steer specific agent |
| `!` | Raw proxy mode — forward keystrokes to agent's tmux session |
| `j/k` | Scroll message feed |
| `d` | Disband team |
| `q` | Quit monitor |

Raw proxy mode shows a live preview of the agent's terminal. Double-Esc to exit.

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Description |
|---|---|---|
| `ENSEMBLE_PORT` | `23000` | Server port |
| `ENSEMBLE_URL` | `http://localhost:23000` | CLI target URL |
| `ENSEMBLE_DATA_DIR` | `~/.ensemble` | Data directory |
| `ENSEMBLE_CORS_ORIGIN` | localhost only | Allowed CORS origins |
| `ENSEMBLE_WATCHDOG_NUDGE_MS` | `900000` (15min) | Idle nudge threshold |
| `ENSEMBLE_WATCHDOG_STALL_MS` | `1200000` (20min) | Stall detection threshold |

## CLI Aliases

Add to `~/.zshrc`:

```bash
export ENSEMBLE_HOME="$HOME/Orchestrator/ensemble"

# Launch teams
alias ens='$ENSEMBLE_HOME/scripts/collab-launch.sh "$(pwd)"'
alias ens-duo='ens --template eng-duo'
alias ens-build='ens --template eng-build'
alias ens-fix='ens --template eng-fix'
alias ens-research='ens --template eng-research'
alias ens-experiment='ens --template eng-experiment'
alias ens-review='ens --template eng-review'
alias ens-iterate='ens --template eng-iterate'
alias ens-full='ens --template eng-full'

# Management
alias ens-monitor='npx --prefix $ENSEMBLE_HOME ensemble monitor'
alias ens-teams='npx --prefix $ENSEMBLE_HOME ensemble teams'
alias ens-steer='npx --prefix $ENSEMBLE_HOME ensemble steer'
alias ens-status='$ENSEMBLE_HOME/scripts/collab-status.sh'
alias ens-replay='$ENSEMBLE_HOME/scripts/collab-replay.sh'
```

## Documentation

- [Getting Started](https://michelhelsdingen.github.io/ensemble/getting-started) — Prerequisites, install, first team
- [Configuration](https://michelhelsdingen.github.io/ensemble/configuration) — Environment variables, agents, hosts
- [API Reference](https://michelhelsdingen.github.io/ensemble/api) — All HTTP endpoints
- [CLI Reference](https://michelhelsdingen.github.io/ensemble/cli) — Commands and monitor keybindings
- [Collab Scripts](https://michelhelsdingen.github.io/ensemble/collab-scripts) — Shell scripts for automation
- [Architecture](https://michelhelsdingen.github.io/ensemble/architecture) — How it all fits together

## License

[MIT](LICENSE)
