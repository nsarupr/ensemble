#!/usr/bin/env bash
# team-say — Send a message to your team feed
# Works inside sandboxed environments (no network needed - writes to file)
# Usage: team-say <team-id> <from> <to> <message>
TEAM_ID="$1"; FROM="$2"; TO="$3"; shift 3; MSG="$*"
DIR="/tmp/orchestra-msgs"
mkdir -p "$DIR"
# Use python for reliable JSON encoding (handles quotes, newlines, special chars)
python3 -c "
import json, sys
msg = {'teamId': sys.argv[1], 'from': sys.argv[2], 'to': sys.argv[3], 'content': ' '.join(sys.argv[4:])}
with open(f'{sys.argv[5]}/{sys.argv[1]}.jsonl', 'a') as f:
    f.write(json.dumps(msg) + '\n')
" "$TEAM_ID" "$FROM" "$TO" "$MSG" "$DIR"
echo "Sent to $TO"
