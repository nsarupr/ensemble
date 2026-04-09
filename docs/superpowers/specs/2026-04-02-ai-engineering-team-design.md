# AI Engineering Team — Agent Design Spec

## Overview

A 10-agent self-organizing AI engineering team running on Ensemble. The team covers the full product engineering lifecycle: research, architecture, implementation, testing, experimentation, reporting, statistical analysis, adversarial critique, and persistent memory.

The user is hands-off — describes features/bugs at a high level, the team self-organizes end-to-end.

## Agent Roster

| # | Agent | Runtime | Role |
|---|-------|---------|------|
| 1 | Tech Lead | Claude CLI | Orchestrator and decision-maker. Only agent that signals completion. |
| 2 | Lead Critic | Codex | Adversarial quality gate. Different model = genuine cognitive diversity. |
| 3 | Researcher | Claude CLI | Discovery, competitive analysis, evidence-backed briefs. |
| 4 | Architect | Claude CLI | System design, interfaces, contracts, eval criteria. |
| 5 | Developer | Codex | Python implementation per Architect's plan. |
| 6 | QA Engineer | Codex | Tests, eval harnesses, experiment execution. |
| 7 | Report Generator | Claude CLI | Structures experiment output into readable reports. |
| 8 | Stats Analyzer (Interpretive) | Claude CLI | Trend analysis, narrative conclusions, acceptance criteria assessment. |
| 9 | Stats Analyzer (Computational) | Codex | Statistical tests, significance, charts via Python. |
| 10 | Memory Keeper | Codex | Shared editable knowledge base with temporal decay. |

Runtime split: Claude CLI (5) for reasoning-heavy roles, Codex (5) for code-execution roles. Lead Critic on Codex ensures model diversity for adversarial review.

## Team Composition Templates

Not all 10 agents spawn for every task. Tech Lead + Lead Critic + Memory Keeper are always present.

| Template | Agents | Use case |
|---|---|---|
| `full` | All 10 | Complex features needing research + implementation + experimentation |
| `build` | TL, Critic, Architect, Dev, QA, Memory | Standard implementation with clear requirements |
| `experiment` | TL, Critic, Researcher, Architect, QA, ReportGen, Stats-C, Memory | Research + evaluate, compare approaches |
| `research` | TL, Critic, Researcher, Memory | Discovery only, no code |
| `fix` | TL, Critic, Dev, QA, Memory | Bug fix |
| `review` | TL, Critic, Architect, Memory | Code review + critique |
| `iterate` | TL, Critic, Dev, QA, ReportGen, Stats-I, Memory | Improve based on previous results |

### Mandatory Artifact Review Sets (per template)

| Template | Critic must PROCEED on |
|---|---|
| `full` | research, plan, code, tests, report, analysis or statistical-analysis |
| `build` | plan, code, tests |
| `experiment` | plan, eval-spec, report, statistical-analysis |
| `research` | research |
| `fix` | code, tests |
| `review` | plan |
| `iterate` | code, tests, report, analysis |

## Communication Protocol

### Safe Vocabulary (CRITICAL)

Ensemble auto-disbands when 2 agents say "done/complete/finished/afgerond/klaar" within 60s. ALL agents must use safe alternatives:

| Banned | Safe replacement |
|---|---|
| "done", "complete", "finished" | "delivered", "submitted", "wrapped up" |
| [STATUS:complete] | [STATUS:ready-for-review] |
| Final completion | [MILESTONE] ALL-CLEAR (Tech Lead ONLY) |

### Message Types

| Type | Mechanism | When |
|---|---|---|
| Direct | `team-say <from> <to> "msg"` | Default for all communication |
| Broadcast | `team-say <from> team "msg"` | [MILESTONE], [HEARTBEAT], [ESCALATE] only |
| Artifact | `team-say <from> <to> "[ARTIFACT:<type>] ..."` | Deliverables for review |
| Memory | `team-say <from> memory-keeper "[MEMORY:op] ..."` | Knowledge base operations |

### Rules

1. Default is targeted, not broadcast.
2. Broadcasts only for: [MILESTONE], [HEARTBEAT], [ESCALATE].
3. Lead Critic receives only [ARTIFACT] messages with context bundles. Treats all other messages as non-authoritative noise.
4. Working Group (Architect + Dev + QA + Report Gen) uses targeted messages among themselves.
5. Tech Lead broadcasts [MILESTONE] EVAL-SPEC-ALIGNED after confirming Working Group consensus.
6. Memory Keeper responds to [MEMORY:*] operations from any agent.
7. Only Tech Lead broadcasts [MILESTONE] ALL-CLEAR.

### Artifact Context Bundle

Every [ARTIFACT] sent to Lead Critic must include:

```
ORIGINAL TASK: <user's exact request>
SPEC: <Tech Lead's expanded spec>
ASSUMPTIONS: <all stated assumptions>
ACCEPTANCE CRITERIA: <what success looks like>
PRIOR VERDICTS: <previous critic decisions if iterating>
---
<artifact content>
```

### Conflict Resolution

1. Agent states position + evidence
2. Opposing agent responds with counter-evidence
3. Tech Lead weighs evidence (hierarchy: test results > benchmarks > code > docs > reasoning)
4. For subjective eval tasks, user-defined criteria outrank the hierarchy
5. Close call → Lead Critic arbitrates
6. Deadlock or high-risk → [ESCALATE] to user
7. Decision logged to Memory Keeper

### Escalation Format

```
[ESCALATE]
ISSUE: <what needs resolution>
IMPACT: <what happens if unresolved>
EVIDENCE: <what the team found>
OPTIONS: <2-3 choices with trade-offs>
RECOMMENDATION: <what the team suggests>
PRIOR ATTEMPTS: <what was tried internally>
```

## Lifecycle Workflow

```
STAGE 1: INTAKE → Tech Lead expands request, queries memory, decides stages
STAGE 2: RESEARCH (optional) → Researcher investigates, Critic reviews
STAGE 3: ARCHITECTURE → Architect designs, Critic reviews
STAGE 4: EVAL DESIGN (if experiments) → Working Group converges on eval spec
STAGE 5: IMPLEMENTATION → Developer codes, QA tests in parallel
STAGE 6: EXPERIMENT & REPORT → QA runs experiments, Report Gen structures, Stats analyzes
STAGE 7: CRITIQUE → Lead Critic reviews all artifacts
STAGE 8: ITERATION (if needed) → Tech Lead routes fixes, loop until PROCEED
STAGE 9: COMPLETION → Tech Lead stores memories, broadcasts ALL-CLEAR
```

### Stage Skipping (Tech Lead decides)

| Task type | Stages |
|---|---|
| Typo/trivial | 1 → 5 → 9 |
| Standard feature | 1 → 3 → 5 → 7 → 9 |
| Feature + research | 1 → 2 → 3 → 5 → 7 → 9 |
| Feature + experiments | 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 |
| Bug fix | 1 → 5 → 7 → 9 |
| Research only | 1 → 2 → 7 → 9 |

### Stats Agent Selection

- Computational: formal significance testing, data validation, chart generation
- Interpretive: narrative assessment, trend comparison, acceptance criteria evaluation
- Both: experiment-heavy tasks needing both rigor and interpretation

### Stats Conflict Resolution

Computational establishes numeric validity → Interpretive assesses product meaning → Lead Critic challenges the chain → Tech Lead resolves with evidence comparison.

## Dual-Scope Memory Design

### Two Scopes

1. **Team scope (session-scoped)**: `/tmp/ensemble/<team-id>/working-memory/entries.json`
   - Structured scratchpad for the current team session
   - Same entry schema as project scope but no temporal decay
   - Lifetime: persists in /tmp until `collab-cleanup.sh` runs
   - More permissive quality gate — intermediate findings OK

2. **Project scope (durable)**: `.team-memory/`
   - Carries forward across teams
   - 90-day TTL with temporal decay
   - Strict quality gate — reject vague/duplicate/noise
   - Entries include `team_id` for provenance

### Location

```
/tmp/ensemble/<team-id>/working-memory/
  entries.json                    ← Team session memory (single indexed store)

<project-root>/.team-memory/
  index.json                      ← Project memory index + schema
  mistakes/
  preferences/
  decisions/
  anti-patterns/
  learnings/
  archive/
```

### Entry Schema (both scopes)

```json
{
  "id": "mem-YYYYMMDD-NNN",
  "category": "mistake|preference|decision|anti-pattern|learning",
  "title": "<concise title>",
  "content": "<detailed description>",
  "evidence": "<what supports this>",
  "created_by": "<agent name>",
  "team_id": "<originating team ID>",
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "expires_at": "<ISO timestamp, +90 days default, project scope only>",
  "relevance_score": 1.0,
  "tags": ["<keyword>"],
  "status": "active|archived|permanent"
}
```

### Operations Protocol

| Operation | scope=team | scope=project | no scope |
|---|---|---|---|
| `[MEMORY:store]` | Write to team entries.json | Write to project .team-memory/ | Default: team |
| `[MEMORY:query]` | Search team only | Search project only (reinforce) | Team first, then project (labeled) |
| `[MEMORY:update]` | Update in team | Update in project | Must specify scope |
| `[MEMORY:deprecate]` | Remove from team | Archive in project | Must specify scope |
| `[MEMORY:promote]` | N/A | Copies from team → project | Tech Lead initiates |

### Promotion Criteria (team → project)

- Mistakes: ALWAYS promote (with root cause)
- Preferences: ALWAYS promote (with rationale)
- Decisions: Only if they set precedent for future work
- Findings: Only if they generalize beyond the current task
- Noise: NEVER promote

### Temporal Decay

- Default TTL: 90 days
- Every 30 days without access: relevance_score drops by 0.3
- At score <= 0 or past expires_at: archived (not deleted)
- "permanent" entries never decay
- Reinforcement on access: score resets to 1.0, TTL extends 90 days

### Operations

- `[MEMORY:store]` — create (validate, deduplicate, assign ID/timestamps)
- `[MEMORY:query]` — search + retrieve (reinforces accessed entries)
- `[MEMORY:update]` — modify (resets timestamps/score)
- `[MEMORY:deprecate]` — archive with reason

### Quality Gate

Reject: vague entries, duplicates (suggest update), noise.
Accept: mistakes with root cause, preferences with rationale, decisions with alternatives, anti-patterns with evidence.

### Fallback

If Memory Keeper is not in the team (edge case), agents skip memory queries and proceed without. Tech Lead is notified.

## Ensemble Platform Considerations

### Completion Detection

Only Tech Lead emits [MILESTONE] ALL-CLEAR. All other agents use [STATUS:ready-for-review]. Safe vocabulary enforced in every agent's system instructions.

### Watchdog

Tech Lead sends [HEARTBEAT] broadcast every 90s during long tasks. Checks on silent agents after 2+ minutes.

### Flat Channel

Independence and role isolation enforced behaviorally through system instructions, not structurally. Lead Critic treats non-artifact messages as noise.

## Critic Validation

Design validated through 4 rounds of adversarial critique (GPT-5.4 via Codex):
- Round 1 (requirements): STOP, confidence 4/10 — fixed memory removal, platform gaps
- Round 2 (roster): PAUSE, confidence 6/10 — fixed runtime assignments, added critic independence protocol
- Round 3 (lead prompts): STOP, confidence 8/10 — fixed banned words, artifact context bundles, behavioral independence
- Round 4 (full system): PAUSE, confidence 7/10 — fixed Memory Keeper availability, completion gate, milestone ownership, stats handoff
