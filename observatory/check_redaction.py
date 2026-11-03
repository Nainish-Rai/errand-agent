#!/usr/bin/env python3
"""Checks a rendered dashboard against the raw Claude Code sessions it was built from (stdlib only).

    python3 -I observatory/check_redaction.py observatory/out/dashboard.html [--claude-root DIR]

For every human prompt and subagent brief in the matching project folders it asserts that the full prompt and any
run of words past the 10-word snippet are absent from the HTML, and that no home path or email
is in it. Every embedded snippet must be at most 10 words; a phrase inside one is allowed. It prints counts only, never prompt text. Exit 0 clean, 1 on a leak.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)  # -I leaves the script's folder off the path

import harness_summary as hs  # noqa: E402

WINDOW = 6  # words; any 6 consecutive words past the snippet must be absent


def human_prompts(path):
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            # subagent briefs (sidechain messages) are checked too: the dashboard keeps 8 words as a title
            if o.get("type") != "user" or o.get("isMeta"):
                continue
            content = (o.get("message") or {}).get("content")
            if isinstance(content, list) and any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content):
                continue
            txt = hs.text_of(content).strip()
            cmd = re.match(r"<command-name>/?([\w:-]+)</command-name>", txt)
            if cmd:  # a slash command, which the analyzer keeps as "/name args"
                args = re.search(r"<command-args>(.*?)</command-args>", txt, re.S)
                txt = "/" + cmd.group(1) + " " + (args.group(1) if args else "")
            # the same injected-text prefixes the analyzer skips
            if txt.strip() and not txt.startswith(("<local-command", "<task-notification", "<system-reminder", "Caveat:", "<bash-")):
                yield txt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("--claude-root", default=hs.CLAUDE_ROOT)
    a = ap.parse_args()
    with open(a.html, encoding="utf-8") as fh:
        html = fh.read()
    files = hs.collect_claude_files(os.path.expanduser(a.claude_root), 0, hs.CLAUDE_PROJECT_MATCH)
    every = [txt for f in files for txt in human_prompts(f)]
    # the prompt text the dashboard does embed: its snippets. A prompt can quote another (a
    # compaction summary does), so a phrase inside any embedded snippet is allowed.
    m = re.search(r'<script id="data" type="application/json">(.*?)</script>', html, re.S)
    data = json.loads(m.group(1).replace("<\\/", "</"))
    allowed = [p["text"] for t in data["traces"].values() for p in t.get("prompt_snippets", [])]
    allowed += [x for tool in data["tools"].values() for c in tool["task_clusters"].values() for x in c["examples"]]
    allowed += [x["title"] for x in data["sessions"] if x.get("title") and x["tool"] != "errand-agent"]
    long_snippets = sum(1 for x in allowed if len(x.replace(" …", "").split()) > 10)
    prompts = leaks = 0
    for txt in every:
        prompts += 1
        # the prompt as the analyzer sees it (tags, paths, keys and ids removed): words past
        # the first 10 never reach the dashboard; neither do raw words past its 600-char cut
        redacted = [w for w in hs.snippet(txt, 10 ** 6).split() if w != "…"]
        # quotes at a word's edge are dropped: JSON quoting in the HTML could pair up with them
        words = [w.strip("\"'`“”‘’") for w in redacted[10:] + txt[600:].split()]
        leaked = len(txt) > 80 and txt in html
        for i in range(0, max(0, len(words) - WINDOW + 1)):
            phrase = " ".join(words[i:i + WINDOW])
            if len(phrase) >= 30 and phrase in html and not any(phrase in ok for ok in allowed):
                leaked = True
                break
        leaks += leaked
    home = os.path.expanduser("~")
    path_leak = home in html
    emails = re.findall(r"\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b", html)
    print("%d session files, %d human prompts checked: %d leaked; %d embedded snippets, %d over 10 words; home path in html: %s; emails in html: %d"
          % (len(files), prompts, leaks, len(allowed), long_snippets, "yes" if path_leak else "no", len(emails)))
    if leaks or long_snippets or path_leak or emails:
        sys.exit(1)


if __name__ == "__main__":
    main()
