#!/usr/bin/env python3
"""
Generate an mIRC-style HTML replay of an ensemble collab session.
Classic IRC look: channel bar, nicklist, timestamps, colored nicks.
Usage: python3 generate-replay-irc.py <team-id> [--task "desc"] [--output replay.html]
"""

import json
import os
import sys
import html
import re
from datetime import datetime

def load_messages(team_id):
    path = f"/tmp/ensemble/{team_id}/messages.jsonl"
    if not os.path.isfile(path):
        print(f"Error: {path} not found", file=sys.stderr)
        sys.exit(1)
    msgs = []
    with open(path) as f:
        for line in f:
            if line.strip():
                try:
                    msgs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return msgs

# Classic mIRC nick colors
NICK_COLORS = {
    "codex": "#5B9BD5",    # blue
    "claude": "#70C770",   # green
    "gemini": "#E5C07B",   # yellow/gold
    "aider": "#C678DD",    # purple
    "ensemble": "#888899", # gray
}

def get_nick_color(name):
    for key, color in NICK_COLORS.items():
        if key in name.lower():
            return color
    return "#CC6666"  # default red


def format_irc_content(text):
    """Format message content for IRC display."""
    text = html.escape(text)
    # Bold **text**
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # Severity tags get colored
    text = re.sub(r'\[(CRITICAL)\]', r'<span class="sev-critical">[\1]</span>', text)
    text = re.sub(r'\[(HIGH)\]', r'<span class="sev-high">[\1]</span>', text)
    text = re.sub(r'\[(MEDIUM)\]', r'<span class="sev-medium">[\1]</span>', text)
    text = re.sub(r'\[(LOW)\]', r'<span class="sev-low">[\1]</span>', text)
    text = re.sub(r'\[(INFO)\]', r'<span class="sev-info">[\1]</span>', text)
    # Newlines
    text = text.replace('\n', '<br>')
    return text


def generate_html(msgs, team_id, task):
    agents = {}
    first_ts = ""
    last_ts = ""

    for m in msgs:
        sender = m.get("from", "")
        if sender and sender != "ensemble":
            if sender not in agents:
                agents[sender] = {"count": 0, "color": get_nick_color(sender)}
            agents[sender]["count"] += 1
        if not first_ts and m.get("timestamp"):
            first_ts = m["timestamp"]
        if m.get("timestamp"):
            last_ts = m["timestamp"]

    total_msgs = sum(a["count"] for a in agents.values())

    duration = ""
    if first_ts and last_ts:
        try:
            t1 = datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            t2 = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
            secs = int((t2 - t1).total_seconds())
            mins = secs // 60
            duration = f"{mins}m {secs % 60}s" if mins else f"{secs}s"
        except Exception:
            pass

    # Channel name
    channel = f"#ensemble-collab"

    # Build nicklist HTML
    nicklist_html = ""
    for name, info in agents.items():
        prefix = "@" if info == list(agents.values())[0] else "+"
        nicklist_html += f'<div class="nick" style="color:{info["color"]}">{prefix}{html.escape(name)}</div>\n'

    # Build messages HTML
    messages_html = ""

    # Join messages
    for name in agents:
        color = agents[name]["color"]
        messages_html += f'<div class="line join">* <span class="nick-ref" style="color:{color}">{html.escape(name)}</span> has joined {channel}</div>\n'

    # Topic set
    messages_html += f'<div class="line topic">* Topic for {channel}: {html.escape(task[:200])}</div>\n'
    messages_html += f'<div class="line separator">---</div>\n'

    for m in msgs:
        sender = m.get("from", "unknown")
        content = m.get("content", "")
        ts = m.get("timestamp", "")

        if sender == "ensemble":
            continue

        time_str = ""
        if ts:
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                time_str = t.strftime("%H:%M")
            except Exception:
                pass

        color = get_nick_color(sender)
        formatted = format_irc_content(content)

        # Pad nick to 12 chars for alignment (visual only)
        messages_html += f'<div class="line msg"><span class="time">[{time_str}]</span> <span class="nick-ref" style="color:{color}">&lt;{html.escape(sender)}&gt;</span> {formatted}</div>\n'

    # Part messages
    for name in agents:
        color = agents[name]["color"]
        messages_html += f'<div class="line part">* <span class="nick-ref" style="color:{color}">{html.escape(name)}</span> has left {channel} (audit complete)</div>\n'

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{channel} — {html.escape(task[:60])}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap');

:root {{
    --bg: #0C0C1A;
    --bg-toolbar: #14142B;
    --bg-input: #0A0A16;
    --bg-nicklist: #0E0E20;
    --border: #1E1E3A;
    --text: #D4D4E8;
    --text-dim: #5A5A7A;
    --time: #4A4A6A;
    --join: #5A8A5A;
    --part: #8A5A5A;
    --topic: #6A6AAA;
    --action: #CC7832;
}}

* {{ margin: 0; padding: 0; box-sizing: border-box; }}

body {{
    font-family: 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}}

/* Toolbar */
.toolbar {{
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    padding: 6px 12px;
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
}}
.toolbar-btn {{
    background: linear-gradient(180deg, #2A2A4A 0%, #1A1A3A 100%);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 2px 10px;
    font-size: 11px;
    font-family: inherit;
    border-radius: 2px;
    cursor: default;
}}
.toolbar-sep {{
    width: 1px;
    height: 18px;
    background: var(--border);
}}

/* Channel bar */
.channel-bar {{
    background: var(--bg-toolbar);
    border-bottom: 1px solid var(--border);
    padding: 4px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}}
.channel-name {{
    color: #7A7ACA;
    font-weight: 500;
}}
.channel-topic {{
    color: var(--text-dim);
    font-size: 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}}

/* Main area */
.main {{
    display: flex;
    flex: 1;
    overflow: hidden;
}}

/* Chat area */
.chat {{
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 1px;
}}

/* Nicklist */
.nicklist {{
    width: 160px;
    background: var(--bg-nicklist);
    border-left: 1px solid var(--border);
    padding: 8px;
    flex-shrink: 0;
    overflow-y: auto;
}}
.nicklist-header {{
    color: var(--text-dim);
    font-size: 11px;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
}}
.nicklist .nick {{
    padding: 1px 0;
    font-size: 12px;
    cursor: default;
}}

/* Input bar */
.inputbar {{
    background: var(--bg-input);
    border-top: 1px solid var(--border);
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}}
.input-nick {{
    color: #7A7ACA;
    white-space: nowrap;
}}
.input-field {{
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 3px 8px;
    font-family: inherit;
    font-size: 12px;
    border-radius: 1px;
    cursor: default;
}}

/* Message lines */
.line {{
    line-height: 1.6;
    word-break: break-word;
}}
.line.msg {{
    padding: 1px 0;
}}
.line.msg:hover {{
    background: rgba(255,255,255,0.02);
}}
.time {{
    color: var(--time);
    font-size: 12px;
}}
.nick-ref {{
    font-weight: 500;
}}
.line.join {{
    color: var(--join);
    font-style: italic;
    font-size: 12px;
}}
.line.part {{
    color: var(--part);
    font-style: italic;
    font-size: 12px;
}}
.line.topic {{
    color: var(--topic);
    font-style: italic;
    font-size: 12px;
}}
.line.separator {{
    color: var(--border);
    text-align: center;
    font-size: 11px;
    margin: 4px 0;
}}

/* Severity */
.sev-critical {{ color: #FF6B6B; font-weight: bold; }}
.sev-high {{ color: #FFAA5B; font-weight: bold; }}
.sev-medium {{ color: #FFD93D; }}
.sev-low {{ color: #A8E06C; }}
.sev-info {{ color: #6BC5FF; }}

.line b {{ color: #E8E8FF; }}

/* Status bar */
.statusbar {{
    background: #0A0A18;
    border-top: 1px solid var(--border);
    padding: 2px 12px;
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-dim);
    flex-shrink: 0;
}}

/* Scrollbar */
.chat::-webkit-scrollbar {{ width: 8px; }}
.chat::-webkit-scrollbar-track {{ background: var(--bg); }}
.chat::-webkit-scrollbar-thumb {{ background: var(--border); border-radius: 4px; }}
.chat::-webkit-scrollbar-thumb:hover {{ background: #2A2A4A; }}

/* Mobile */
@media (max-width: 640px) {{
    .nicklist {{ display: none; }}
    body {{ font-size: 12px; }}
}}
</style>
</head>
<body>

<div class="toolbar">
    <span class="toolbar-btn">File</span>
    <span class="toolbar-btn">View</span>
    <span class="toolbar-btn">Favorites</span>
    <span class="toolbar-btn">Tools</span>
    <span class="toolbar-btn">Help</span>
    <span class="toolbar-sep"></span>
    <span style="color:var(--text-dim);font-size:11px;">ensemble v1.0 — multi-agent collaboration</span>
</div>

<div class="channel-bar">
    <span class="channel-name">{channel}</span>
    <span class="channel-topic">{html.escape(task[:200])}</span>
</div>

<div class="main">
    <div class="chat" id="chat">
        <div class="line topic">* Now talking in <b style="color:#7A7ACA">{channel}</b></div>
        <div class="line topic">* Topic is: {html.escape(task[:200])}</div>
        <div class="line topic">* Set by <b style="color:#7A7ACA">ensemble</b></div>
        <div class="line separator">---</div>
        {messages_html}
    </div>
    <div class="nicklist">
        <div class="nicklist-header">{len(agents)} users in {channel}</div>
        {nicklist_html}
    </div>
</div>

<div class="inputbar">
    <span class="input-nick">[spectator]</span>
    <input class="input-field" value="This is a replay — {total_msgs} messages, {duration}" readonly>
</div>

<div class="statusbar">
    <span>{channel} [{len(agents)} users]</span>
    <span>ensemble replay — {total_msgs} messages — {duration}</span>
    <span><a href="https://github.com/michelhelsdingen/ensemble" style="color:#6A6AAA;text-decoration:none">github.com/michelhelsdingen/ensemble</a></span>
</div>

</body>
</html>'''


def main():
    if len(sys.argv) < 2:
        print("Usage: generate-replay-irc.py <team-id> [--task 'desc'] [--output file.html]", file=sys.stderr)
        sys.exit(1)

    team_id = sys.argv[1]
    output = "replay-irc.html"
    task = "Ensemble Collaboration Session"

    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output = sys.argv[idx + 1]

    if "--task" in sys.argv:
        idx = sys.argv.index("--task")
        if idx + 1 < len(sys.argv):
            task = sys.argv[idx + 1]

    # Try API
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://localhost:23000/api/ensemble/teams/{team_id}", timeout=2) as resp:
            team_data = json.loads(resp.read())
            api_task = team_data.get("team", {}).get("description", "")
            if api_task:
                task = api_task
    except Exception:
        pass

    msgs = load_messages(team_id)
    if not msgs:
        print("No messages found", file=sys.stderr)
        sys.exit(1)

    html_content = generate_html(msgs, team_id, task)

    with open(output, "w") as f:
        f.write(html_content)

    agent_count = len(set(m.get("from") for m in msgs if m.get("from") != "ensemble"))
    msg_count = len([m for m in msgs if m.get("from") != "ensemble"])
    print(f"✓ Generated {output} ({msg_count} messages, {agent_count} agents) — mIRC style")


if __name__ == "__main__":
    main()
