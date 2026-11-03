#!/usr/bin/env python3
"""Summarise errand-agent run traces, and optionally this repo's Claude Code build sessions.

Copied from harness-observatory (MIT, see LICENSE and README.md) and adapted: an errand-agent
source reads `errand.trace/1` JSONL traces, Claude Code sessions are limited to the folders of
this repo, Codex is opt-in, and model cost is carried through.

Stdlib only, read-only on the logs. Writes harness-summary.json.
Never stores prompt text: only sanitised snippets of at most 10 words.

    python3 -I harness_summary.py [--traces DIR ...] [--claude-sessions] [--codex]
                                  [--days N] [--out harness-summary.json] [--max-traces 200]
"""
import argparse
import collections
import concurrent.futures as cf
import datetime as dt
import hashlib
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
CLAUDE_ROOT = os.path.join(HOME, ".claude", "projects")
CODEX_ROOT = os.path.join(HOME, ".codex", "sessions")
CODEX_HISTORY = os.path.join(HOME, ".codex", "history.jsonl")
CODEX_INDEX = os.path.join(HOME, ".codex", "session_index.jsonl")
# Claude Code keeps one folder per working directory; these hold the sessions that built this repo.
CLAUDE_PROJECT_MATCH = ("errand-agent", "larp-about-https-www-orangeinvest")
ERRAND_SCHEMA = "errand.trace/1"
NOT_LOGGED = "not logged"
MAX_SPANS = 1600  # turns and tool calls always kept; LLM spans dropped first when over

# ---------------------------------------------------------------- sanitising

_SECRET = re.compile(
    r"(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_\w+|xox[abprs]-[\w-]+"
    r"|AKIA[0-9A-Z]{12,}|AIza[\w-]{20,}|eyJ[\w-]{10,}\.[\w-]+\.[\w-]+|Bearer\s+\S+)"
)
_URL = re.compile(r"\b(?:https?|ssh|git|ftp|wss?)://\S+|\bwww\.\S+", re.I)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PATH = re.compile(r"(?:~|\.{1,2})?/[\w.@~+-]+(?:/[\w.@~+-]*)*|\b[A-Za-z]:\\\S+|\b[\w.-]+/[\w./-]+")
_ASSIGN = re.compile(r"\b(\w*(?:key|token|secret|password|passwd|pwd|auth)\w*)\s*[:=]\s*\S+", re.I)
_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
_LONGID = re.compile(r"\b(?=[\w-]*\d)[\w-]{16,}\b|\b[0-9a-f]{8,}\b", re.I)
_TAG = re.compile(r"<[^>]{0,80}>")
_MENTION = re.compile(r"@[A-Z][\w.-]*(?:\s+[A-Z][\w-]*)?|@\S+")
_ESCAPED = re.compile(r"\S*\\\s?\S*")
_FILE = re.compile(r"\b[\w.-]+\.(?:pdf|png|jpe?g|gif|csv|xlsx?|docx?|pptx?|json|ya?ml|md|txt|zip|html?|py|tsx?|jsx?|sql|env|pem|key)\b", re.I)


def snippet(text, words=10):
    """At most `words` words, with secrets, URLs, paths, emails and long ids removed."""
    if not text:
        return ""
    t = _TAG.sub(" ", str(text)[:600])
    t = _SECRET.sub(" ", t)
    t = _ASSIGN.sub(lambda m: m.group(1) + "=…", t)
    t = _URL.sub(" ", t)
    t = _EMAIL.sub(" ", t)
    t = _MENTION.sub(" ", t)
    t = _ESCAPED.sub(" ", t)
    t = _FILE.sub(" ", t)
    t = _UUID.sub(" ", t)
    t = _PATH.sub(" ", t)
    t = _LONGID.sub(" ", t)
    w = [x for x in re.split(r"\s+", t) if x and re.search(r"\w", x)]
    out = " ".join(w[:words])
    return out + (" …" if len(w) > words else "")


# ---------------------------------------------------------------- classifiers

TASK_RULES = [
    ("debug", r"\b(bug|bugs|error|errors|fix|fixes|broken|fail|fails|failing|failed|crash\w*|not working|doesn'?t work|isn'?t working|issue|exception|traceback|debug\w*|diagnos\w*|wrong|why is|why does|stuck|regression)\b"),
    ("deploy", r"\b(merged?|commit\w*|pr|pull request|deploy\w*|release|rollout|roll out|argo\w*|kubectl|helm|terraform|prod|production|staging|ci|pipeline|merge|push|ship|devbox|docker|k8s|eks)\b"),
    ("review", r"\b(status|check|check now|review\w*|audit|verify|verification|double.?check|critique|pr comments?|feedback on|look over|sanity.?check)\b"),
    ("UI", r"\b(ui|ux|design\w*|css|layout|component\w*|page|screen|button|style\w*|dashboard|figma|tailwind|frontend|front-end|visual\w*|theme|animation|responsive|landing)\b"),
    ("research", r"\b(research|find out|investigate|compare|what is|what are|how does|how do|explore|search|look up|understand|explain|learn|options for|best way)\b"),
    ("writing", r"\b(write|draft|doc|docs|readme|message|slack|ticket|email|summary|summari[sz]e|rewrite|blog|post|linear|prd|spec|handover|notes?)\b"),
    ("build", r"\b(build|implement\w*|add|create|make|feature|scaffold|set ?up|integrat\w*|refactor\w*|migrat\w*|script|endpoint|api|wire|hook up|support)\b"),
]
TASK_RES = [(k, re.compile(p, re.I)) for k, p in TASK_RULES]
TASK_TYPES = [k for k, _ in TASK_RULES] + ["other"]
CONTINUE_RE = re.compile(r"^\W*(?:(?:ok|okay|yes|yeah|y|yep|go|go on|go ahead|c\w{0,3}nt?\w{0,3}n\w{0,2}e?|done|do it|proceed|next|sure|k|lgtm|ship it|keep going|good|\d)\W*)+$", re.I)


def classify(text):
    t = (text or "").strip()
    if not t or CONTINUE_RE.match(t) or len(t) < 4:
        return "other"
    best, score = "other", 0
    for k, rx in TASK_RES:
        n = len(rx.findall(t[:2000]))
        if n > score:  # strict: earlier rule wins ties
            best, score = k, n
    return best


def claude_error_type(text):
    t = text or ""
    rules = [
        ("permission_denied", r"Permission for this (action|command) was denied|permission denied"),
        ("user_rejected", r"doesn'?t want to proceed|user rejected|was rejected by the user|Request interrupted"),
        ("hook_blocked", r"hook error|blocked by hook|PreToolUse|PostToolUse"),
        ("subagent_isolation", r"This agent is isolated"),
        ("file_not_read_first", r"File has not been read yet"),
        ("file_changed_since_read", r"File has been modified since read|modified since"),
        ("file_not_found", r"^\s*File does not exist|No such file or directory|ENOENT"),
        ("edit_no_match", r"String to replace not found|Found \d+ matches of the string"),
        ("blocked_command", r"Blocked sleep|is blocked|not allowed"),
        ("timeout", r"timed? ?out|Timeout|deadline exceeded"),
        ("input_validation", r"InputValidationError|invalid input|Invalid tool parameters|validation error"),
        ("http_error", r"\bHTTP \d{3}\b|status code [45]\d\d|\b(?:4|5)\d\d (?:Bad|Not|Internal|Service|Forbidden|Unauthorized)"),
    ]
    for name, rx in rules:
        if re.search(rx, t[:3000], re.I):
            return name
    m = re.match(r"\s*Exit code (\d+)", t)
    if m:
        return "exit_%s" % m.group(1)
    if t.startswith("<tool_use_error>"):
        return "tool_use_error"
    return "other_error"


def codex_error_type(out):
    t = out or ""
    if re.search(r"timed? ?out", t[:500], re.I):
        return "timeout"
    if t.startswith("failed to parse"):
        return "parse_error"
    if re.search(r"rejected|denied|not approved", t[:500], re.I):
        return "permission_denied"
    if t.startswith("Script failed"):
        return "script_failed"
    return "other_error"


# ---------------------------------------------------------------- helpers

def parse_ts(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s) / (1000.0 if s > 1e11 else 1.0)
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def day_of(ts):
    return dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


def project_name(cwd):
    if not cwd:
        return "unknown"
    p = cwd.rstrip("/")
    if p.startswith(HOME):
        p = "~" + p[len(HOME):]
    parts = [x for x in p.split("/") if x and x != "~"]
    if ".claude" in parts and "worktrees" in parts:  # agent worktree inside a repo
        parts = parts[:parts.index(".claude")]
    elif "worktrees" in parts:
        return "worktrees/" + re.sub(r"^autopilot-", "", parts[-1])[:48]
    if parts[:1] == ["development"]:
        parts = parts[1:]
    if not parts:
        return "~"
    if parts[0] in ("private", "tmp") or "tmp" in parts[:2]:
        return "tmp"
    return "/".join(parts[:2])[:60]


def h(obj):
    try:
        s = json.dumps(obj, sort_keys=True)
    except TypeError:
        s = str(obj)
    return hashlib.sha1(s.encode()).hexdigest()[:12]


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for c in content:
            if isinstance(c, dict):
                if c.get("type") == "text":
                    out.append(c.get("text") or "")
                elif isinstance(c.get("content"), (str, list)):
                    out.append(text_of(c["content"]))
            elif isinstance(c, str):
                out.append(c)
        return "\n".join(out)
    return ""


def empty_tokens():
    return {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}


def add_tokens(a, b):
    for k in a:
        a[k] += b.get(k, 0) or 0


def total_tokens(t):
    return sum(t.values())


def new_session(tool, sid, path):
    return {
        "tool": tool, "id": sid, "file": os.path.basename(path), "cwd": None, "title": None,
        "subagent": False, "parent": None, "first": None, "last": None, "event_ts": [],
        "prompts": [], "tool_calls": [], "tokens_by_model": {}, "models": collections.Counter(),
        "turns": [], "generations": [], "interrupts": 0, "compactions": 0,
    }


def touch(s, ts):
    if ts is None:
        return
    s["first"] = ts if s["first"] is None else min(s["first"], ts)
    s["last"] = ts if s["last"] is None else max(s["last"], ts)
    s["event_ts"].append(ts)


def model_tokens(s, model, tok, ts):
    d = s["tokens_by_model"].setdefault(model, {})
    day = day_of(ts)
    dd = d.setdefault(day, empty_tokens())
    add_tokens(dd, tok)
    s["models"][model] += total_tokens(tok)


# ---------------------------------------------------------------- Claude Code

def parse_claude(path, since):
    rel = os.path.relpath(path, CLAUDE_ROOT).split(os.sep)
    is_sub = "subagents" in rel
    sid = os.path.splitext(rel[-1])[0]
    s = new_session("claude-code", sid, path)
    if is_sub:
        s["subagent"] = True
        s["parent"] = rel[-3] if len(rel) >= 3 else None
        try:
            with open(path[:-len(".jsonl")] + ".meta.json") as mf:
                meta = json.load(mf)
            s["title"] = meta.get("description") or None
            s["agent_type"] = meta.get("agentType")
        except (OSError, ValueError):
            pass
    pending = {}
    msgs = collections.OrderedDict()  # message.id -> dict(model, usage, first_ts, last_ts, prev_ts)
    prev_ts = None
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            t = o.get("type")
            if t == "ai-title" and o.get("aiTitle"):
                s["title"] = o["aiTitle"]
                continue
            ts = parse_ts(o.get("timestamp"))
            if ts is None:
                continue
            if ts < since:
                prev_ts = ts
                continue
            if o.get("cwd") and not s["cwd"]:
                s["cwd"] = o["cwd"]
            if t not in ("user", "assistant", "attachment", "system"):
                continue
            touch(s, ts)
            m = o.get("message") or {}
            content = m.get("content")
            if t == "assistant":
                mid = m.get("id") or o.get("uuid")
                model = m.get("model") or "unknown"
                rec = msgs.get(mid)
                if rec is None:
                    rec = msgs[mid] = {"model": model, "usage": None, "first": ts, "last": ts, "prev": prev_ts if prev_ts is not None else ts}
                rec["last"] = ts
                if m.get("usage"):
                    rec["usage"] = m["usage"]
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "tool_use":
                            pending[c.get("id")] = {
                                "name": c.get("name") or "unknown", "start": ts, "end": None,
                                "ok": None, "error_type": None, "input_hash": h(c.get("input")),
                                "target": target_key(c.get("name"), c.get("input")),
                                "cmd_head": command_head((c.get("input") or {}).get("command")) if c.get("name") == "Bash" else None,
                                "model": model,
                            }
                            s["tool_calls"].append(pending[c.get("id")])
            elif t == "user":
                if isinstance(content, list) and any(isinstance(c, dict) and c.get("type") == "tool_result" for c in content):
                    for c in content:
                        if not (isinstance(c, dict) and c.get("type") == "tool_result"):
                            continue
                        call = pending.pop(c.get("tool_use_id"), None)
                        if call is None:
                            continue
                        call["end"] = ts
                        err = bool(c.get("is_error"))
                        call["ok"] = not err
                        if err:
                            call["error_type"] = claude_error_type(text_of(c.get("content")))
                            if call["name"] == "Bash":
                                call["head"] = call.get("cmd_head")
                            if call["error_type"] == "user_rejected":
                                s["interrupts"] += 1
                else:
                    txt = text_of(content)
                    if is_sub and not s.get("task") and txt.strip() and not o.get("isMeta"):
                        s["task"] = txt  # the delegated brief; only a sanitised snippet is kept
                    if o.get("isMeta") or o.get("isSidechain"):
                        pass
                    elif (o.get("origin") or {}).get("kind") not in (None, "human") or o.get("promptSource") == "system":
                        pass
                    elif txt.startswith("[Request interrupted"):
                        s["interrupts"] += 1
                    elif txt.startswith(("<local-command", "<task-notification", "<system-reminder", "Caveat:", "<bash-")):
                        pass
                    elif txt.strip():
                        cmd = re.match(r"<command-name>/?([\w:-]+)</command-name>", txt)
                        if cmd:
                            args = re.search(r"<command-args>(.*?)</command-args>", txt, re.S)
                            txt = "/" + cmd.group(1) + " " + (args.group(1) if args else "")
                        s["prompts"].append({"ts": ts, "type": classify(txt), "snippet": snippet(txt), "slash": bool(cmd)})
            elif t == "system" and o.get("subtype") == "compact_boundary":
                s["compactions"] += 1
            prev_ts = ts
    for mid, rec in msgs.items():
        u = rec["usage"]
        if rec["model"] == "<synthetic>":
            continue
        if u:
            tok = {
                "input": u.get("input_tokens") or 0,
                "output": u.get("output_tokens") or 0,
                "cache_read": u.get("cache_read_input_tokens") or 0,
                "cache_write": u.get("cache_creation_input_tokens") or 0,
            }
            model_tokens(s, rec["model"], tok, rec["last"])
            s["llm_calls"] = s.get("llm_calls", 0) + 1
        s["generations"].append({"start": min(rec["prev"], rec["first"]), "end": rec["last"], "model": rec["model"],
                                 "tokens": total_tokens(tok) if u else None})
    return finish_session(s)


# ---------------------------------------------------------------- Codex

def parse_codex(path, since):
    s = new_session("codex", None, path)
    turn_model = {}
    pending = {}
    turns = {}
    default_model = None
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            t = o.get("type")
            p = o.get("payload") or {}
            if not isinstance(p, dict):
                continue
            if t == "session_meta":
                m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$", path)
                s["id"] = m.group(1) if m else (p.get("id") or p.get("session_id"))  # subagent files share the root id
                s["cwd"] = p.get("cwd")
                src = p.get("source")
                if isinstance(src, dict) and "subagent" in src:
                    s["subagent"] = True
                    spawn = (src.get("subagent") or {}).get("thread_spawn") or {}
                    s["parent"] = spawn.get("parent_thread_id")
                continue
            if t == "turn_context":
                turn_model[p.get("turn_id")] = p.get("model")
                default_model = p.get("model") or default_model
                if p.get("cwd") and not s["cwd"]:
                    s["cwd"] = p["cwd"]
                continue
            ts = parse_ts(o.get("timestamp"))
            if ts is None or ts < since:
                continue
            pt = p.get("type")
            if t == "event_msg" and pt == "thread_settings_applied":
                default_model = (p.get("thread_settings") or {}).get("model") or default_model
                continue
            if t == "event_msg" and pt == "token_count":
                continue
            touch(s, ts)
            meta = p.get("internal_chat_message_metadata_passthrough") or {}
            if t == "token_usage_record":
                u = p.get("usage") or {}
                cached = u.get("cached_input_tokens") or 0
                tok = {
                    "input": max((u.get("input_tokens") or 0) - cached, 0),
                    "output": u.get("output_tokens") or 0,
                    "cache_read": cached,
                    "cache_write": u.get("cache_write_input_tokens") or 0,
                }
                model = turn_model.get(p.get("turn_id")) or default_model or "unknown"
                model_tokens(s, model, tok, ts)
                s["llm_calls"] = s.get("llm_calls", 0) + 1
            elif t == "event_msg" and pt == "task_started":
                turns[p.get("turn_id")] = {"start": ts, "end": None, "id": p.get("turn_id")}
            elif t == "event_msg" and pt == "task_complete":
                tr = turns.get(p.get("turn_id"))
                if tr:
                    tr["end"] = ts
            elif t == "event_msg" and pt == "turn_aborted":
                s["interrupts"] += 1
                tr = turns.get(p.get("turn_id"))
                if tr:
                    tr["end"] = ts
                    tr["aborted"] = True
            elif t == "compacted":
                s["compactions"] += 1
            elif t == "response_item" and pt in ("function_call", "custom_tool_call"):
                name = p.get("name") or "unknown"
                if p.get("namespace"):
                    name = p["namespace"] + "." + name
                args = p.get("arguments") if pt == "function_call" else p.get("input")
                call = {"name": name, "start": ts, "end": None, "ok": None, "error_type": None,
                        "input_hash": h(args), "target": target_key(name, args), "turn": meta.get("turn_id"),
                        "model": turn_model.get(meta.get("turn_id")) or default_model}
                pending[p.get("call_id")] = call
                if name != "exec":
                    s["tool_calls"].append(call)
                else:
                    s.setdefault("exec_wrappers", []).append(call)
            elif t == "response_item" and pt in ("function_call_output", "custom_tool_call_output"):
                call = pending.pop(p.get("call_id"), None)
                if call is None:
                    continue
                out = p.get("output")
                if isinstance(out, list):
                    out = text_of(out)
                out = str(out or "")
                call["end"] = ts
                bad = out.startswith(("Script failed", "failed to parse", "Error", "error:")) or bool(re.match(r'\{"error"', out))
                call["ok"] = not bad
                if bad:
                    call["error_type"] = codex_error_type(out)
            elif t == "event_msg" and pt == "item_completed":
                it = p.get("item") or {}
                kind = it.get("type")
                start = parse_ts(p.get("started_at_ms")) or ts
                end = parse_ts(p.get("completed_at_ms")) or ts
                call = None
                if kind == "CommandExecution":
                    code = it.get("exit_code")
                    failed = it.get("status") == "failed" or (code not in (0, None))
                    call = {"name": "shell", "ok": not failed,
                            "error_type": ("exit_%s" % code if code not in (None, 0) else "failed") if failed else None,
                            "input_hash": h(it.get("command")), "target": target_key("shell", it.get("command")),
                            "head": command_head(it.get("command")) if failed else None}
                    du = it.get("duration") or {}
                    if du.get("secs") is not None:  # the logged duration is authoritative; anchor it on completion
                        start = end - (du.get("secs", 0) + (du.get("nanos") or 0) / 1e9)
                elif kind == "McpToolCall":
                    res = it.get("result") or {}
                    failed = it.get("status") == "failed" or bool(res.get("isError"))
                    call = {"name": "mcp:%s.%s" % (it.get("server"), it.get("tool")), "ok": not failed,
                            "error_type": "mcp_error" if failed else None, "input_hash": h(it.get("arguments"))}
                elif kind == "FileChange":
                    failed = it.get("status") == "failed"
                    call = {"name": "apply_patch", "ok": not failed, "error_type": "patch_failed" if failed else None,
                            "input_hash": h(sorted((it.get("changes") or {}).keys()))}
                elif kind == "ImageView":
                    call = {"name": "view_image", "ok": True, "error_type": None, "input_hash": h(it.get("path"))}
                elif kind == "UserMessage" and not s["subagent"]:
                    txt = text_of(it.get("content"))
                    if txt.strip() and not txt.lstrip().startswith("<"):
                        s["prompts"].append({"ts": ts, "type": classify(txt), "snippet": snippet(txt), "slash": txt.startswith("/")})
                elif kind == "UserMessage" and s["subagent"]:
                    if not s.get("task"):
                        s["task"] = text_of(it.get("content"))
                    s.setdefault("delegated_tasks", 0)
                    s["delegated_tasks"] += 1
                if call:
                    call.update({"start": start, "end": end, "turn": p.get("turn_id"),
                                 "model": turn_model.get(p.get("turn_id")) or default_model})
                    s["tool_calls"].append(call)
    for tr in turns.values():
        tr["end"] = tr["end"] or s["last"]
        s["turns"].append(tr)
    if s["id"] is None:
        s["id"] = os.path.basename(path)
    return finish_session(s)


# ---------------------------------------------------------------- errand-agent

# A tool may report a transient failure as a typed outcome instead of throwing ("expected failures
# are values"); such a call still counts as failed, so a retry after it is visible.
ERRAND_FAILED_KINDS = {"timeout", "service_unavailable", "unavailable", "rate_limited", "internal_error"}
ERRAND_STATUS_TOOL = re.compile(r"status", re.I)


def read_errand_records(path):
    """The latest record of each span (a late "running" record never reopens an ended span) and every event."""
    spans = collections.OrderedDict()
    events = []
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except ValueError:
                continue  # a line cut short by a crash mid-write
            if not isinstance(o, dict) or o.get("schema") != ERRAND_SCHEMA:
                continue
            if o.get("type") == "event":
                events.append(o)
            elif o.get("type") == "span" and o.get("spanId"):
                cur = spans.get(o["spanId"])
                if cur is None or cur.get("status") == "running" or o.get("status") != "running":
                    spans[o["spanId"]] = o
    return list(spans.values()), events


def _num(attrs, key):
    v = attrs.get(key)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _ms(v):
    return v / 1000.0 if isinstance(v, (int, float)) else None


def errand_error_type(span):
    """`error.type` of a failed span, or the failure `kind` a settled tool returned as a value."""
    a = span.get("attributes") or {}
    if span.get("status") == "error":
        return re.sub(r"\W+", "_", str(a.get("error.type") or "error")).strip("_") or "error"
    res = a.get("gen_ai.tool.call.result")
    if isinstance(res, dict) and res.get("kind") in ERRAND_FAILED_KINDS:
        return res["kind"]
    return None


def errand_target(name, args):
    """Calls with the same idempotency key act on the same thing, whatever else changed."""
    if isinstance(args, dict):
        for k in ("idempotency_key", "idempotencyKey", "proposal_id", "proposalId", "booking_id", "bookingId"):
            if args.get(k):
                return k + ":" + h(args[k])
    return target_key(name, args)


def parse_errand(path, project):
    spans, events = read_errand_records(path)
    if not spans:
        return []
    root = spans[0].get("traceId") or os.path.splitext(os.path.basename(path))[0]
    by_id = {x["spanId"]: x for x in spans}
    sessions = collections.OrderedDict()

    def session_for(sid):
        s = sessions.get(sid)
        if s is None:
            s = sessions[sid] = new_session("errand-agent", sid, path)
            s["project"] = project
            s["cost_usd"] = None
            s["cost_sources"] = collections.Counter()
            s["events"] = collections.Counter()
            if sid != root:
                s["subagent"] = True
                s["parent"] = root
        return s

    session_for(root)
    for x in sorted(spans, key=lambda x: x.get("startTimeMs") or 0):
        s = session_for(x.get("sessionId") or root)
        a = x.get("attributes") or {}
        start = _ms(x.get("startTimeMs"))
        end = _ms(x.get("endTimeMs"))
        running = x.get("status") == "running"
        touch(s, start)
        touch(s, end)
        kind = x.get("kind")
        if kind == "agent":
            seq = _num(a, "errand.turn.sequence")
            s["turns"].append({"start": start, "end": end, "id": "turn-%d" % ((seq if seq is not None else len(s["turns"])) + 1),
                               "aborted": x.get("status") == "error"})
            if s["subagent"] and a.get("errand.subagent.name"):
                s["title"] = s["title"] or "subagent " + str(a["errand.subagent.name"])
                s["agent_type"] = a["errand.subagent.name"]
            elif not s["subagent"]:
                s["prompts"].append({"ts": start, "type": "turn", "snippet": "", "slash": False})
        elif kind == "model":
            model = a.get("gen_ai.response.model") or a.get("gen_ai.request.model") or "unknown"
            inp, out = _num(a, "gen_ai.usage.input_tokens"), _num(a, "gen_ai.usage.output_tokens")
            cr = _num(a, "gen_ai.usage.cache_read.input_tokens") or 0
            cw = _num(a, "gen_ai.usage.cache_creation.input_tokens") or 0
            tok = None
            if inp is not None or out is not None:
                # AI SDK input tokens include cached ones; the dashboard counts them apart.
                tok = {"input": max((inp or 0) - cr - cw, 0), "output": out or 0, "cache_read": cr, "cache_write": cw}
                model_tokens(s, model, tok, end or start)
                s["llm_calls"] = s.get("llm_calls", 0) + 1
            cost = _num(a, "errand.cost.usd")
            if cost is not None:
                s["cost_usd"] = (s["cost_usd"] or 0) + cost
                s["cost_sources"][a.get("errand.cost.source") or "unknown"] += 1
            s["generations"].append({"start": start, "end": end or start, "model": model,
                                     "tokens": total_tokens(tok) if tok else None, "ok": x.get("status") != "error",
                                     "error_type": errand_error_type(x), "cost": cost,
                                     "cost_source": a.get("errand.cost.source"), "provider": a.get("gen_ai.provider.name")})
        elif kind == "tool":
            name = a.get("gen_ai.tool.name") or re.sub(r"^execute_tool\s+", "", x.get("name") or "") or "unknown"
            args = a.get("gen_ai.tool.call.arguments")
            err = None if running else errand_error_type(x)
            step = by_id.get(x.get("parentSpanId") or "") or {}
            s["tool_calls"].append({
                "name": name, "start": start, "end": end, "ok": None if running else err is None,
                "error_type": err, "input_hash": h(args), "target": errand_target(name, args),
                "model": (step.get("attributes") or {}).get("gen_ai.request.model"),
            })
    for e in events:
        s = sessions.get(e.get("sessionId")) or sessions[root]
        s["events"][e.get("kind") or "event"] += 1
        s.setdefault("event_marks", []).append({"ts": _ms(e.get("timeMs")), "kind": e.get("kind") or "event", "name": e.get("name") or ""})
    out = []
    for s in sessions.values():
        # turns come from the trace's own turn spans, not from prompts as for Claude Code
        s["turns"].sort(key=lambda t: t["start"] or 0)
        for t in s["turns"]:
            t["end"] = t["end"] or s["last"]
        tools = []
        for c in sorted(s["tool_calls"], key=lambda c: c["start"] or 0):
            if c["name"] not in tools:
                tools.append(c["name"])
        if not s["title"]:
            s["title"] = "%d turn%s · %s" % (len(s["turns"]), "" if len(s["turns"]) == 1 else "s",
                                             " → ".join(tools[:4]) + (" …" if len(tools) > 4 else "") if tools else "no tool calls")
        fin = finish_session(s)
        if fin:
            fin["task_type"] = "subagent run" if fin["subagent"] else "errand run"
            mark_verifications(fin["tool_calls"])
            mark_model_retries(fin)
            out.append(fin)
    return out


def mark_verifications(calls):
    """A status check right after a timeout is how the agent learns whether the call took effect."""
    for i, c in enumerate(calls):
        if c["ok"] is False and c["error_type"] == "timeout":
            for d in calls[i + 1:i + 4]:
                if ERRAND_STATUS_TOOL.search(d["name"]):
                    d["verify"] = True
                    break


def mark_model_retries(s):
    gens = sorted(s["generations"], key=lambda g: g["start"] or 0)
    for i, g in enumerate(gens[:-1]):
        if g.get("ok") is False:
            gens[i + 1]["retry"] = True
            s["retries"].append({"tool": "llm:" + g["model"], "error_type": g.get("error_type") or "error",
                                 "kind": "exact", "recovered": gens[i + 1].get("ok") is not False})


# ---------------------------------------------------------------- per session

def pct(vals, q):
    if not vals:
        return None
    v = sorted(vals)
    k = max(0, min(len(v) - 1, int(round(q / 100.0 * len(v) + 0.5)) - 1))
    return round(v[k], 3)


def active_seconds(ts_list, gap=1800):
    if not ts_list:
        return 0
    v = sorted(ts_list)
    return round(sum(min(b - a, gap) for a, b in zip(v, v[1:])), 1)


def command_head(cmd):
    """First word of a shell command, or a placeholder when it is a path or a variable assignment."""
    if isinstance(cmd, list):
        cmd = cmd[-1] if cmd else ""
    cmd = re.sub(r"^\s*(cd\s+\S+\s*(&&|;)\s*)+", "", str(cmd or ""))
    w = cmd.split()
    if not w:
        return "?"
    if "=" in w[0]:
        return "<var assignment>"
    if "/" in w[0]:
        return os.path.basename(w[0])[:24] or "<path>"
    return w[0][:24]


def target_key(name, args):
    """Coarse identity of what a call acts on, so a retry with tweaked flags still matches."""
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {"command": args}
    if isinstance(args, list):
        args = {"command": args[-1] if args else ""}
    if not isinstance(args, dict):
        return h(args)
    if "command" in args or "cmd" in args:
        cmd = str(args.get("command") or args.get("cmd") or "")
        cmd = re.sub(r"^\s*(cd\s+\S+\s*(&&|;)\s*)+", "", cmd)
        return "cmd:" + " ".join(cmd.split()[:2])
    for k in ("file_path", "path", "url", "query", "pattern", "skill"):
        if k in args:
            return k + ":" + h(args[k])
    return h(args)


def find_retries(calls):
    out = []
    for i, c in enumerate(calls):
        if c["ok"] is not False:
            continue
        for d in calls[i + 1:i + 4]:
            if d["name"] == c["name"] and (d["input_hash"] == c["input_hash"] or d.get("target") == c.get("target")):
                d["retry"] = True
                out.append({"tool": c["name"], "error_type": c["error_type"],
                            "kind": "exact" if d["input_hash"] == c["input_hash"] else "adjusted",
                            "recovered": d["ok"] is True})
                break
    return out


def finish_session(s):
    if s["first"] is None:
        return None
    calls = sorted(s["tool_calls"], key=lambda c: c["start"] or 0)
    for c in calls:
        c["dur"] = round(c["end"] - c["start"], 3) if c.get("end") and c.get("start") else None
    s["tool_calls"] = calls
    s["retries"] = find_retries(calls)
    s["active_s"] = active_seconds(s["event_ts"])
    s["wall_s"] = round(s["last"] - s["first"], 1)
    del s["event_ts"]
    tok = empty_tokens()
    for model, days in s["tokens_by_model"].items():
        for d in days.values():
            add_tokens(tok, d)
    s["tokens"] = tok
    if s["tool"] == "claude-code":
        # turns from prompts
        pts = [p["ts"] for p in s["prompts"]]
        for i, t0 in enumerate(pts):
            t1 = pts[i + 1] if i + 1 < len(pts) else s["last"]
            s["turns"].append({"start": t0, "end": t1, "id": "turn-%d" % (i + 1)})
    types = collections.Counter(p["type"] for p in s["prompts"] if p["type"] != "other")
    s["task_type"] = types.most_common(1)[0][0] if types else "other"
    return s


# ---------------------------------------------------------------- aggregate

def collect_files(root, since_mtime):
    out = []
    for dirpath, _, files in os.walk(root):
        for f in files:
            if f.endswith(".jsonl"):
                fp = os.path.join(dirpath, f)
                try:
                    if os.path.getmtime(fp) >= since_mtime:
                        out.append(fp)
                except OSError:
                    pass
    return out


def collect_claude_files(root, since_mtime, match):
    """Claude Code sessions whose project folder name contains one of `match` (all when empty)."""
    out = []
    if not os.path.isdir(root):
        return out
    for d in sorted(os.listdir(root)):
        if match and not any(m in d for m in match):
            continue
        out += collect_files(os.path.join(root, d), since_mtime)
    return out


def run_parse(args):
    kind, path, extra = args
    try:
        if kind == "errand":
            return parse_errand(path, extra)
        res = (parse_claude if kind == "claude" else parse_codex)(path, extra)
        return [res] if res else []
    except Exception as e:  # one bad file never kills the run
        return [{"_error": "%s: %s" % (os.path.basename(path), type(e).__name__)}]


def health(s):
    n = len(s["tool_calls"])
    ok = sum(1 for c in s["tool_calls"] if c["ok"] is not False)
    sr = ok / n if n else 1.0
    r = len(s["retries"])
    score = 100 * (0.6 * sr + 0.2 * (1 - min(r / 5.0, 1)) + 0.2 * (1 - min(s["interrupts"] / 3.0, 1)))
    return round(score), round(sr, 4)


def summarise(sessions, since, now, codex_history_prompts, parse_errors, max_traces, tool_names=("claude-code", "codex")):
    tools = {}
    for name in tool_names:
        ss = [s for s in sessions if s["tool"] == name]
        main = [s for s in ss if not s["subagent"]]
        calls = [c for s in ss for c in s["tool_calls"]]
        by_tool = collections.Counter(c["name"] for c in calls)
        failed = collections.Counter(c["name"] for c in calls if c["ok"] is False)
        err_types = collections.Counter((c["name"], c["error_type"]) for c in calls if c["ok"] is False)
        lat = collections.defaultdict(list)
        for c in calls:
            if c["dur"] is not None and c["dur"] >= 0:
                lat[c["name"]].append(c["dur"])
        all_lat = [x for v in lat.values() for x in v]
        sess_per_day = collections.Counter(day_of(s["first"]) for s in main)
        sub_per_day = collections.Counter(day_of(s["first"]) for s in ss if s["subagent"])
        prompts = [p for s in main for p in s["prompts"]]
        prompts_per_day = collections.Counter(day_of(p["ts"]) for p in prompts)
        tok_model_day = {}
        model_totals = {}
        for s in ss:
            for model, days in s["tokens_by_model"].items():
                md = tok_model_day.setdefault(model, {})
                for d, t in days.items():
                    add_tokens(md.setdefault(d, empty_tokens()), t)
                add_tokens(model_totals.setdefault(model, empty_tokens()), {k: sum(v[k] for v in days.values()) for k in empty_tokens()})
        model_calls = collections.Counter(c.get("model") or "unknown" for c in calls)
        model_fail = collections.Counter(c.get("model") or "unknown" for c in calls if c["ok"] is False)
        model_sessions = collections.Counter(s["models"].most_common(1)[0][0] for s in ss if s["models"])
        retries = [dict(r, session=s["id"]) for s in ss for r in s["retries"]]
        cluster = {}
        for t in TASK_TYPES:
            ps = [p for p in prompts if p["type"] == t]
            sess_ids = sorted({s["id"] for s in main for p in s["prompts"] if p["type"] == t})
            cluster[t] = {"prompts": len(ps), "sessions": len(sess_ids),
                          "examples": [p["snippet"] for p in ps if p["snippet"]][:5],
                          "session_ids": sess_ids[:20]}
        tools[name] = {
            "sessions": len(main), "subagent_runs": len(ss) - len(main),
            "sessions_per_day": dict(sorted(sess_per_day.items())),
            "subagent_runs_per_day": dict(sorted(sub_per_day.items())),
            "user_prompts": len(prompts),
            "user_prompts_per_day": dict(sorted(prompts_per_day.items())),
            "slash_commands": sum(1 for p in prompts if p["slash"]),
            "tool_calls": len(calls),
            "tool_calls_by_tool": dict(by_tool.most_common()),
            "failed_tool_calls": sum(failed.values()),
            "failed_by_tool": dict(failed.most_common()),
            "failed_by_tool_and_error": [
                {"tool": a, "error_type": b, "count": n,
                 "sessions": sorted({s["id"] for s in ss for c in s["tool_calls"] if c["ok"] is False and c["name"] == a and c["error_type"] == b}),
                 "command_heads": dict(collections.Counter(c.get("head") for c in calls if c["ok"] is False and c["name"] == a and c["error_type"] == b and c.get("head")).most_common(5)),
                 "per_day": dict(sorted(collections.Counter(day_of(c["start"]) for c in calls if c["ok"] is False and c["name"] == a and c["error_type"] == b).items()))}
                for (a, b), n in err_types.most_common()],
            "unanswered_tool_calls": sum(1 for c in calls if c["ok"] is None),
            "models": sorted(model_totals),
            "tokens_by_model": model_totals,
            "tokens_by_model_by_day": {m: dict(sorted(d.items())) for m, d in tok_model_day.items()},
            "model_table": [
                {"model": m, "tokens": model_totals.get(m, empty_tokens()), "total": total_tokens(model_totals.get(m, empty_tokens())),
                 "sessions_dominant": model_sessions.get(m, 0), "tool_calls": model_calls.get(m, 0),
                 "tool_errors": model_fail.get(m, 0),
                 "error_rate": round(model_fail.get(m, 0) / model_calls[m], 4) if model_calls.get(m) else None}
                for m in sorted(set(model_totals) | set(model_calls), key=lambda m: -total_tokens(model_totals.get(m, empty_tokens())))
            ],
            "latency_s": {
                "overall": {"p50": pct(all_lat, 50), "p95": pct(all_lat, 95), "n": len(all_lat)},
                "per_tool": {k: {"p50": pct(v, 50), "p95": pct(v, 95), "max": round(max(v), 3), "n": len(v)}
                             for k, v in sorted(lat.items(), key=lambda kv: -len(kv[1]))},
            },
            "session_length_s": {
                "wall": {"p50": pct([s["wall_s"] for s in main], 50), "p95": pct([s["wall_s"] for s in main], 95)},
                "active": {"p50": pct([s["active_s"] for s in main], 50), "p95": pct([s["active_s"] for s in main], 95)},
            },
            "retries": {"total": len(retries),
                        "exact": sum(1 for r in retries if r["kind"] == "exact"),
                        "adjusted": sum(1 for r in retries if r["kind"] == "adjusted"),
                        "recovered": sum(1 for r in retries if r["recovered"]),
                        "by_tool": dict(collections.Counter(r["tool"] for r in retries).most_common()),
                        "by_error": dict(collections.Counter(r["error_type"] for r in retries).most_common())},
            "task_clusters": cluster,
            "interrupts": sum(s["interrupts"] for s in ss),
            "compactions": sum(s["compactions"] for s in ss),
        }
        if name == "codex":
            ex = [c for s in ss for c in s.get("exec_wrappers", [])]
            tools[name]["exec_wrapper_calls"] = {"calls": len(ex), "failed": sum(1 for c in ex if c["ok"] is False),
                                                 "note": "Codex 'exec' script wrappers; their inner shell/MCP/patch items are counted as tool calls"}
            tools[name]["history_prompts"] = codex_history_prompts
            tools[name]["cost_usd"] = NOT_LOGGED
        elif name == "errand-agent":
            costs = [s["cost_usd"] for s in ss if s.get("cost_usd") is not None]
            tools[name]["cost_usd"] = round(sum(costs), 6) if costs else NOT_LOGGED
            src = collections.Counter()
            for s in ss:
                src.update(s.get("cost_sources") or {})
            tools[name]["cost_sources"] = dict(src.most_common())
            by_model = collections.defaultdict(float)
            for s in ss:
                for g in s["generations"]:
                    if g.get("cost") is not None:
                        by_model[g["model"]] += g["cost"]
            tools[name]["cost_by_model"] = {m: round(v, 6) for m, v in by_model.items()}
            ev = collections.Counter()
            for s in ss:
                ev.update(s.get("events") or {})
            tools[name]["events"] = dict(ev)
            tools[name]["failed_llm_calls"] = sum(1 for s in ss for g in s["generations"] if g.get("ok") is False)
        else:
            tools[name]["cost_usd"] = NOT_LOGGED

    rows = []
    for s in sessions:
        sc, sr = health(s)
        n_err = sum(1 for c in s["tool_calls"] if c["ok"] is False)
        rows.append({
            "id": s["id"], "short": str(s["id"])[:8], "tool": s["tool"], "project": s.get("project") or project_name(s["cwd"]),
            # errand titles are built from tool names only, so they need no snippet
            "title": s["title"] if s["tool"] == "errand-agent" else snippet(s["title"]) if s["title"] else (snippet(s["task"], 8) or None) if s.get("task") else None,
            "subagent": s["subagent"], "parent": s["parent"], "agent_type": s.get("agent_type"),
            "start": dt.datetime.fromtimestamp(s["first"]).isoformat(timespec="seconds"),
            "start_ts": s["first"], "wall_s": s["wall_s"], "active_s": s["active_s"],
            "prompts": len(s["prompts"]), "tool_calls": len(s["tool_calls"]), "errors": n_err,
            "tokens": s["tokens"], "tokens_total": total_tokens(s["tokens"]),
            "model": s["models"].most_common(1)[0][0] if s["models"] else None,
            "models": list(s["models"]), "task_type": s["task_type"],
            "llm_calls": s.get("llm_calls", 0),
            "avg_context": round((s["tokens"]["input"] + s["tokens"]["cache_read"] + s["tokens"]["cache_write"]) / s["llm_calls"]) if s.get("llm_calls") else None,
            "retries": len(s["retries"]), "interrupts": s["interrupts"], "compactions": s["compactions"],
            "health": sc, "tool_success_rate": sr,
            "cost_usd": round(s["cost_usd"], 6) if s.get("cost_usd") is not None else None,
            "cost_source": "+".join(sorted(s["cost_sources"])) if s.get("cost_sources") else None,
            "llm_errors": sum(1 for g in s["generations"] if g.get("ok") is False),
            "events": dict(s["events"]) if s.get("events") else None,
        })
    rows.sort(key=lambda r: -r["tokens_total"])
    by_id = {s["id"]: s for s in sessions}
    traces = {}
    for r in rows[:max_traces]:
        s = by_id[r["id"]]
        spans = []
        for tr in s["turns"]:
            spans.append({"k": "turn", "n": tr["id"], "s": tr["start"], "e": tr["end"], "ok": not tr.get("aborted")})
        for g in s["generations"]:
            sp = {"k": "llm", "n": g["model"], "s": g["start"], "e": g["end"], "ok": g.get("ok", True), "t": g["tokens"]}
            if g.get("error_type"):
                sp["err"] = g["error_type"]
            if g.get("retry"):
                sp["r"] = 1
            if g.get("cost") is not None:
                sp["c"] = g["cost"]
                sp["cs"] = g.get("cost_source")
            spans.append(sp)
        for c in s["tool_calls"]:
            spans.append({"k": "tool", "n": c["name"], "s": c["start"], "e": c["end"] or c["start"], "ok": c["ok"] is not False,
                          "err": c["error_type"], "pending": c["ok"] is None, "r": 1 if c.get("retry") else None,
                          "v": 1 if c.get("verify") else None})
        for m in s.get("event_marks", []):
            spans.append({"k": "ev", "n": m["kind"] + " · " + snippet(m["name"], 6), "s": m["ts"], "e": m["ts"], "ok": True})
        spans.sort(key=lambda x: (x["s"] or 0, x["k"] != "turn"))
        truncated = False
        if len(spans) > MAX_SPANS:
            spans = [x for x in spans if x["k"] != "llm"]
            truncated = "llm"
        if len(spans) > MAX_SPANS:
            spans = spans[:MAX_SPANS]
            truncated = "tail"
        t0 = s["first"]
        for x in spans:
            x["s"] = round((x["s"] or t0) - t0, 2)
            x["e"] = round((x["e"] or t0) - t0, 2)
        # errand traces hold no prompt text, so they carry no snippets
        traces[r["id"]] = {"spans": spans, "truncated": truncated,
                           "prompt_snippets": [{"t": round(p["ts"] - t0, 1), "type": p["type"], "text": p["snippet"]} for p in s["prompts"] if s["tool"] != "errand-agent"][:60]}

    projects = collections.defaultdict(lambda: {"sessions": 0, "subagent_runs": 0, "tokens": 0, "tool_calls": 0, "errors": 0, "tools": collections.Counter()})
    for r in rows:
        p = projects[r["project"]]
        p["subagent_runs" if r["subagent"] else "sessions"] += 1
        p["tokens"] += r["tokens_total"]
        p["tool_calls"] += r["tool_calls"]
        p["errors"] += r["errors"]
        p["tools"][r["tool"]] += 1
    proj = sorted(({"project": k, **{kk: (dict(vv) if isinstance(vv, collections.Counter) else vv) for kk, vv in v.items()}} for k, v in projects.items()),
                  key=lambda x: -x["tokens"])

    # eval runs pin the world's clock, so a trace can sit after now; the window still covers it
    until = max([now] + [s["last"] for s in sessions if s["last"]])
    all_calls = sum(t["tool_calls"] for t in tools.values())
    all_fail = sum(t["failed_tool_calls"] for t in tools.values())
    all_lat = [c["dur"] for s in sessions for c in s["tool_calls"] if c["dur"] is not None and c["dur"] >= 0]
    headline = {
        "tool_calls": all_calls,
        "user_prompts": sum(t["user_prompts"] for t in tools.values()),
        "error_rate": round(all_fail / all_calls, 4) if all_calls else None,
        "tokens": sum(r["tokens_total"] for r in rows),
        "p95_tool_latency_s": pct(all_lat, 95),
        "sessions": sum(t["sessions"] for t in tools.values()),
        "subagent_runs": sum(t["subagent_runs"] for t in tools.values()),
    }
    return {
        "generated_at": dt.datetime.fromtimestamp(now).isoformat(timespec="seconds"),
        "window": {"since": dt.datetime.fromtimestamp(since).isoformat(timespec="seconds"),
                   "until": dt.datetime.fromtimestamp(until).isoformat(timespec="seconds"), "days": round((until - since) / 86400)},
        "timezone": str(dt.datetime.now().astimezone().tzinfo),
        "headline": headline,
        "tools": tools,
        "projects": proj,
        "sessions": rows,
        "top_sessions_by_tokens": [r["id"] for r in rows[:10]],
        "longest_sessions": [r["id"] for r in sorted(rows, key=lambda r: -r["active_s"])[:10]],
        "most_retries": [r["id"] for r in sorted(rows, key=lambda r: -r["retries"]) if r["retries"]][:10],
        "traces": traces,
        "traces_embedded": len(traces),
        "parse_errors": parse_errors,
        "notes": {
            "errand_traces": "errand-agent: one errand.trace/1 file per root session; the latest finished record of each span wins. Turns are invoke_agent spans, LLM calls chat spans (tokens, latency, errand.cost.usd), tool calls execute_tool spans. Prompt and tool text is not embedded.",
            "errand_cost": "errand-agent cost per model call as the trace records it: price_table = estimated from src/adapters/tracing/prices.json (MiniMax), provider_reported = the cost the Claude Code CLI reports. Claude Code build sessions do not log cost.",
            "errand_failures": "an errand tool call fails when its span has status error, or when it returns a transient failure as a value (kind timeout or service_unavailable). A status check after a timeout is marked verify.",
            "tokens": "input excludes cache reads for both tools (Codex input_tokens minus cached_input_tokens). total = input+output+cache_read+cache_write.",
            "claude_tokens": "Claude Code repeats usage on every content block of one API message; counted once per message.id.",
            "latency": "Claude Code tool latency = tool_result timestamp minus tool_use timestamp, so it includes time waiting on a permission prompt. Codex uses item started/completed ms or call/output timestamps.",
            "llm_spans": "Claude Code generation spans start at the previous logged event (request start is not logged).",
            "codex_llm_spans": NOT_LOGGED,
            "session_length": "wall = first to last event in window; active = sum of gaps between events capped at 30 min.",
            "prompts": "Claude Code: human-origin user text, excluding meta, sidechain, task notifications and local command output. Codex: UserMessage items in non-subagent sessions that do not start with an injected tag.",
            "task_types": "keyword heuristic per prompt; session task type = most common non-'other' prompt type. 'other' includes continuations like 'ok', 'continue'.",
            "health": "heuristic: 60% tool success rate + 20% (1 - retries/5) + 20% (1 - interrupts/3), 0-100.",
            "retries": "a failed call followed within the next 3 calls by the same tool, matched on input hash or target (for errand-agent, the idempotency key); 'exact' when the input hash matches. A failed LLM call followed by another counts as an LLM retry.",
            "cost_usd": NOT_LOGGED,
            "codex_history_jsonl": "history.jsonl prompt count in the window, a cross-check for Codex user_prompts.",
        },
    }


def main():
    global CLAUDE_ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument("--traces", action="append", default=[], metavar="DIR",
                    help="errand-agent trace directory (repeatable); default traces/ when it exists")
    ap.add_argument("--claude-sessions", action="store_true",
                    help="add the Claude Code sessions that built this repo (folders matching --claude-match)")
    ap.add_argument("--claude-root", default=CLAUDE_ROOT)
    ap.add_argument("--claude-match", action="append", default=None, metavar="TEXT",
                    help="project folder substring (repeatable); default: %s" % ", ".join(CLAUDE_PROJECT_MATCH))
    ap.add_argument("--codex", action="store_true", help="add Codex sessions from ~/.codex (the original source)")
    ap.add_argument("--days", type=float, default=None,
                    help="window for Claude Code and Codex sessions; default: all of this repo's sessions, 7 days for Codex")
    ap.add_argument("--out", default="harness-summary.json")
    ap.add_argument("--max-traces", type=int, default=200)
    a = ap.parse_args()
    CLAUDE_ROOT = os.path.abspath(os.path.expanduser(a.claude_root))
    now = dt.datetime.now().timestamp()
    since = now - a.days * 86400 if a.days is not None else 0
    trace_dirs = a.traces or (["traces"] if os.path.isdir("traces") else [])
    jobs, tool_names = [], []
    for d in trace_dirs:
        if not os.path.isdir(d):
            ap.error("no trace directory %s" % d)
        label = os.path.relpath(os.path.abspath(d))
        label = label if not label.startswith("..") else os.path.basename(os.path.abspath(d))
        jobs += [("errand", os.path.join(d, f), label) for f in sorted(os.listdir(d)) if f.endswith(".jsonl")]
    if trace_dirs:
        tool_names.append("errand-agent")
    if a.claude_sessions:
        jobs += [("claude", f, since) for f in collect_claude_files(CLAUDE_ROOT, since, a.claude_match or CLAUDE_PROJECT_MATCH)]
        tool_names.append("claude-code")
    if a.codex:
        codex_since = since or now - 7 * 86400
        jobs += [("codex", f, codex_since) for f in collect_files(CODEX_ROOT, codex_since)]
        tool_names.append("codex")
    if not tool_names:
        ap.error("nothing to read: no traces/ directory; pass --traces DIR or --claude-sessions")
    sessions, errors = [], []
    with cf.ProcessPoolExecutor() as ex:
        for res in ex.map(run_parse, jobs, chunksize=1):
            for r in res:
                if "_error" in r:
                    errors.append(r["_error"])
                else:
                    sessions.append(r)
    hist = 0
    if a.codex and os.path.exists(CODEX_HISTORY):
        with open(CODEX_HISTORY, errors="replace") as fh:
            for line in fh:
                try:
                    ts = parse_ts(json.loads(line).get("ts"))
                except ValueError:
                    continue
                if ts and ts >= since:
                    hist += 1
    names = {}
    if a.codex and os.path.exists(CODEX_INDEX):
        with open(CODEX_INDEX, errors="replace") as fh:
            for line in fh:
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                names[o.get("id")] = o.get("thread_name")
    for s in sessions:
        if s["tool"] == "codex" and not s["title"]:
            s["title"] = names.get(s["id"])
    # the window opens at the oldest session read, so old eval traces still show
    start = min([s["first"] for s in sessions] + ([since] if since else []) or [now])
    out = summarise(sessions, start, now, hist, errors, a.max_traces, tool_names)
    if not a.codex:
        for k in [k for k in out["notes"] if k.startswith("codex")]:
            del out["notes"][k]
    kinds = {"errand": "errand-agent", "claude": "claude-code", "codex": "codex"}
    out["files_scanned"] = {t: sum(1 for j in jobs if kinds[j[0]] == t) for t in tool_names}
    with open(a.out, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), default=str)
    hd = out["headline"]
    cost = out["tools"].get("errand-agent", {}).get("cost_usd")
    print("sessions %d (+%d subagent runs), prompts/turns %d, tool calls %d, error rate %s, tokens %d, p95 latency %ss, errand cost %s -> %s (%.1f MB)" % (
        hd["sessions"], hd["subagent_runs"], hd["user_prompts"], hd["tool_calls"], hd["error_rate"], hd["tokens"],
        hd["p95_tool_latency_s"], ("$%.6f" % cost) if isinstance(cost, (int, float)) else "not logged", a.out, os.path.getsize(a.out) / 1e6))
    if errors:
        print("parse errors:", len(errors), file=sys.stderr)


if __name__ == "__main__":
    main()
