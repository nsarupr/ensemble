#!/usr/bin/env bash
# orchestra-bridge — Watches message file and posts to API
# Usage: orchestra-bridge.sh <team-id> [api-url]
TEAM_ID="${1:?Usage: orchestra-bridge.sh <team-id>}"
API="${2:-http://localhost:23000}"
FILE="/tmp/orchestra-msgs/$TEAM_ID.jsonl"
POSTED_FILE="/tmp/orchestra-bridge-posted-$TEAM_ID"

mkdir -p /tmp/orchestra-msgs
touch "$FILE"

if [ -f "$POSTED_FILE" ]; then
  POSTED=$(tr -d ' ' < "$POSTED_FILE" 2>/dev/null)
else
  POSTED=0
  echo "0" > "$POSTED_FILE"
fi

echo "[bridge] Watching $FILE"

while true; do
  TOTAL=$(wc -l < "$FILE" 2>/dev/null | tr -d ' ')
  POSTED=$(cat "$POSTED_FILE" 2>/dev/null | tr -d ' ')
  [ -z "$TOTAL" ] && TOTAL=0
  [ -z "$POSTED" ] && POSTED=0
  if [ "$POSTED" -gt "$TOTAL" ] 2>/dev/null; then
    POSTED=0
    echo "0" > "$POSTED_FILE"
  fi

  if [ "$TOTAL" -gt "$POSTED" ]; then
    # Process new lines — only advance posted counter on success
    NEW_POSTED=$(python3 -c "
import json, urllib.request, sys, re
from itertools import islice

team_id = '$TEAM_ID'
api = '$API'
posted = $POSTED
last_success = posted

with open('$FILE') as f:
    for i, line in enumerate(islice(f, posted, None), start=posted):
        line = line.strip()
        if not line:
            last_success = i + 1
            continue
        try:
            cleaned = re.sub(r'\\\\\\\\([^\"\\\\\\\\nrtbfu/])', r'\\1', line)
            msg = json.loads(cleaned)
        except json.JSONDecodeError:
            try:
                msg = json.loads(line)
            except:
                print(f'[bridge] skip malformed line {i}', file=sys.stderr, flush=True)
                last_success = i + 1
                continue

        content = msg.get('content','')
        if not content:
            last_success = i + 1
            continue

        data = json.dumps({
            'from': msg.get('from',''),
            'to': msg.get('to','team'),
            'content': content
        }).encode()

        try:
            req = urllib.request.Request(
                f'{api}/api/orchestra/teams/{team_id}',
                data=data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            urllib.request.urlopen(req, timeout=5)
            fr = msg.get('from','?')
            to = msg.get('to','?')
            c = content[:60]
            print(f'[bridge] {fr} -> {to}: {c}...', file=sys.stderr, flush=True)
            last_success = i + 1
        except Exception as e:
            print(f'[bridge] api error line {i}, will retry: {e}', file=sys.stderr, flush=True)
            break  # Stop processing, retry failed line next cycle

# Output the last successfully posted line number
print(last_success, flush=True)
" 2>&1 1>/tmp/orchestra-bridge-result-$TEAM_ID)

    # Echo captured stderr (diagnostic messages) so they appear in bridge log
    [ -n "$NEW_POSTED" ] && echo "$NEW_POSTED" >&2

    # Read the last line (the counter) from stdout
    RESULT=$(cat /tmp/orchestra-bridge-result-$TEAM_ID 2>/dev/null | tail -1)
    if [ -n "$RESULT" ] && [ "$RESULT" -ge "$POSTED" ] 2>/dev/null; then
      echo "$RESULT" > "$POSTED_FILE"
    fi
  fi

  sleep 1
done
