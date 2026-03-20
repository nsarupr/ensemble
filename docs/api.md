---
title: API Reference
---

# API Reference

Base URL: `http://localhost:23000` (configurable via `ORCHESTRA_PORT`)

Rate limit: 100 requests per 60 seconds per IP.

---

## Health

### `GET /api/v1/health`

```bash
curl http://localhost:23000/api/v1/health
```

```json
{ "status": "healthy", "version": "1.0.0" }
```

---

## Teams

### `POST /api/orchestra/teams` — Create team

```bash
curl -X POST http://localhost:23000/api/orchestra/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "review-team",
    "description": "Review the auth module for security issues",
    "agents": [
      { "program": "codex", "role": "lead", "hostId": "local" },
      { "program": "claude", "role": "worker", "hostId": "local" }
    ],
    "workingDirectory": "/path/to/project",
    "feedMode": "live",
    "useWorktrees": false,
    "templateName": null,
    "staged": false
  }'
```

**Required fields:**
- `description` (string) — task for the team
- `agents` (array) — at least one agent with `program` field

**Optional fields:**
- `name` (string) — team name (auto-generated if omitted)
- `workingDirectory` (string) — project path for agents
- `feedMode` (`"live"` or `"batch"`) — message delivery mode
- `useWorktrees` (boolean) — isolate agents in git worktrees
- `templateName` (string) — use a collab template (`review`, `implement`, `debug`)
- `staged` (boolean) — enable staged plan/execute/verify workflow
- `stagedConfig` (object) — phase timeouts and settings

**Response:** `{ "team": OrchestraTeam }`

Returns `400` for malformed JSON, `429` for rate limit exceeded.

---

### `GET /api/orchestra/teams` — List teams

```bash
curl http://localhost:23000/api/orchestra/teams
```

**Response:** `{ "teams": OrchestraTeam[] }`

---

### `GET /api/orchestra/teams/:id` — Get team details

```bash
curl http://localhost:23000/api/orchestra/teams/abc-123
```

**Response:** `{ "team": OrchestraTeam, "messages": OrchestraMessage[] }`

---

### `POST /api/orchestra/teams/:id` — Send message

```bash
curl -X POST http://localhost:23000/api/orchestra/teams/abc-123 \
  -H "Content-Type: application/json" \
  -d '{
    "from": "user",
    "to": "codex-1",
    "content": "Focus on the auth module"
  }'
```

**Fields:**
- `content` (string, required) — message text
- `to` (string, required) — recipient agent name
- `from` (string) — sender name (default: `"user"`)

Returns `400` for malformed JSON.

---

### `DELETE /api/orchestra/teams/:id` — Disband team

```bash
curl -X DELETE http://localhost:23000/api/orchestra/teams/abc-123
```

Stops all agents, generates summary, cleans up. Also available as `POST /api/orchestra/teams/:id/disband`.

**Response:** `{ "team": OrchestraTeam }`

---

## Feed

### `GET /api/orchestra/teams/:id/feed` — Message feed

```bash
# All messages
curl http://localhost:23000/api/orchestra/teams/abc-123/feed

# Incremental (since timestamp)
curl "http://localhost:23000/api/orchestra/teams/abc-123/feed?since=2026-03-20T10:00:00Z"
```

**Query params:**
- `since` (ISO 8601 timestamp) — only return messages after this time

**Response:** `{ "messages": OrchestraMessage[] }`

Use the `since` parameter for efficient polling — avoids re-fetching the entire message history.

---

## Types

### OrchestraTeam

```typescript
{
  id: string
  name: string
  description: string
  status: 'forming' | 'active' | 'paused' | 'completed' | 'disbanded' | 'failed'
  agents: OrchestraTeamAgent[]
  createdBy: string
  createdAt: string // ISO 8601
  feedMode: 'live' | 'batch'
  workingDirectory?: string
  useWorktrees?: boolean
}
```

### OrchestraTeamAgent

```typescript
{
  program: string
  role: string
  hostId: string
  status: 'spawning' | 'active' | 'idle' | 'done' | 'failed'
  worktreePath?: string
  worktreeBranch?: string
}
```

### OrchestraMessage

```typescript
{
  id: string
  teamId: string
  from: string
  to: string
  content: string
  type: string
  timestamp: string // ISO 8601
}
```
