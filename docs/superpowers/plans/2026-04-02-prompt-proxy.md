# Agent Prompt Detection & Raw Keystroke Proxy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when agents are stuck on interactive prompts, surface the prompt content in the monitor feed, and allow users to send raw keystrokes to agents from the monitor.

**Architecture:** Watchdog detects stalled panes via `tmux capture-pane`, posts prompt content to team feed. Monitor adds raw proxy mode (`!` key) that forwards arbitrary keystrokes to a selected agent's tmux session via `tmux send-keys`.

**Tech Stack:** TypeScript, tmux, Node.js child_process

---

### Task 1: Add prompt detection to watchdog

**Files:**
- Modify: `lib/agent-watchdog.ts`

### Task 2: Add raw proxy mode to monitor

**Files:**
- Modify: `cli/monitor.ts`

### Task 3: Add prompt detection API endpoint

**Files:**
- Modify: `services/ensemble-service.ts`
- Modify: `server.ts`
