#!/usr/bin/env python3
"""Shared JSONL message parser for collab scripts.

Usage:
  parse-messages.py <file> [--skip N] [--max-content N] [--include-orchestra] [--meta-only]

Modes:
  Default:    Outputs "sender\\tcontent" lines (skips orchestra messages).
  --meta-only: Outputs 4 lines: count, first_ts, last_ts, last_content.

Options:
  --skip N            Skip first N lines (for incremental polling). Default: 0.
  --max-content N     Truncate content to N chars. Default: 500. Use 0 for no limit.
  --include-orchestra Include orchestra messages in output.
  --meta-only         Output metadata summary instead of messages.
"""
import json
import re
import sys


def parse_args(argv):
    args = {"file": None, "skip": 0, "max_content": 500, "include_orchestra": False, "meta_only": False}
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg == "--skip" and i + 1 < len(argv):
            i += 1
            args["skip"] = int(argv[i])
        elif arg == "--max-content" and i + 1 < len(argv):
            i += 1
            args["max_content"] = int(argv[i])
        elif arg == "--include-orchestra":
            args["include_orchestra"] = True
        elif arg == "--meta-only":
            args["meta_only"] = True
        elif not arg.startswith("-") and args["file"] is None:
            args["file"] = arg
        i += 1
    return args


def read_lines(filepath, skip):
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return f.readlines()[skip:]
    except FileNotFoundError:
        return []


def parse_message(raw):
    line = raw.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def clean_content(text, max_len):
    cleaned = re.sub(r"/tmp/orchestra[-\w]*/", "", str(text)).strip()
    if max_len > 0 and len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    return cleaned


def output_messages(lines, args):
    for raw in lines:
        msg = parse_message(raw)
        if msg is None:
            continue
        sender = msg.get("from", "")
        if sender == "orchestra" and not args["include_orchestra"]:
            continue
        content = clean_content(msg.get("content", ""), args["max_content"])
        if content:
            print(f"{sender}\t{content}")


def output_meta(lines, args):
    count = 0
    first_ts = ""
    last_ts = ""
    last_content = ""

    for raw in lines:
        msg = parse_message(raw)
        if msg is None:
            continue
        count += 1
        ts = msg.get("timestamp") or ""
        if not first_ts and ts:
            first_ts = ts
        if ts:
            last_ts = ts
        content = str(msg.get("content", "")).replace("\n", " ").replace("\t", " ").strip()
        if content:
            last_content = " ".join(content.split())

    print(count)
    print(first_ts)
    print(last_ts)
    print(last_content)


def main():
    args = parse_args(sys.argv)
    if not args["file"]:
        print("Usage: parse-messages.py <file> [--skip N] [--max-content N] [--include-orchestra] [--meta-only]", file=sys.stderr)
        sys.exit(1)

    lines = read_lines(args["file"], args["skip"])

    if args["meta_only"]:
        output_meta(lines, args)
    else:
        output_messages(lines, args)


if __name__ == "__main__":
    main()
