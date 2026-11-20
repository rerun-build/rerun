import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import limits as L

RETRY_BACKOFF_S = (60, 120, 240)
_ERR = ("provider_overloaded", "429", "rate limit", "sign-in renewed during the run", "403 attention required")
_OVERLOADED = re.compile(r"overloaded|rate.?limit|too many requests|at capacity|high demand|service unavailable", re.I)
_SPENT = re.compile(r"hit your (?:session|weekly|opus|sonnet|usage) limit|usage limit reached|usage_limit_exceeded|5-hour limit|quota exceeded|monthly spend limit|usage credits|not supported when using codex with a chatgpt account|does not exist or you do not have access|opencode console credits used up|opencode go limit reached|openai api credits used up|no credits remaining|insufficient_quota", re.I)
_NOT_IN_PLAN = re.compile(r"not supported when using codex with a chatgpt account|does not exist or you do not have access|requires usage credits|model_not_found", re.I)
_ROOM = ("builders are already active", "GB free, floor is", "of memory available, floor is", "/data/work is over", "TRANSIENT: ")
ROOM_HOLDS = (("disk:", "disk", 15 * 60), ("memory:", "load", 5 * 60), ("load:", "load", 5 * 60))
_TOOL_LINE = re.compile(r"(?m)^TRANSIENT: (.*)$")
_TOOL_QUOTED = re.compile(r"TRANSIENT: (.*)")


def tool_refusals(out, blocked):
    return _TOOL_LINE.findall(out or "") + _TOOL_QUOTED.findall(blocked or "")


def room(refusals):
    return [(text, kind, hold_s) for text in refusals for mark, kind, hold_s in ROOM_HOLDS if text.startswith(mark)]


def seen_after(run, prev, now_iso):
    steps = run["steps"]
    if prev is None:
        return {"steps": steps, "at": run["startedAt"]}
    if prev["steps"] != steps:
        return {"steps": steps, "at": now_iso}
    return {"steps": prev["steps"], "at": prev["at"]}


def outcome(run, seen, now, cfg=None):
    if run is None:
        return L.run_outcome(None, now, None, cfg)
    if cfg is None:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner.json")) as f:
            cfg = json.load(f)
    row = {"id": run["runId"], "status": run["status"], "started_at": run["startedAt"], "error": run.get("error")}
    steps = {"last_step_at": (seen or {}).get("at"), "tokens": run.get("totalTokens") or 0}
    return L.run_outcome(row, now, steps, cfg)


def klass(kind, run=None, blocked=None):
    if kind in ("DONE", "RUNNING"):
        return None
    if kind in ("RESTARTED", "MISSING"):
        return "transient"
    if kind == "CANCEL":
        return "cancel"
    if kind == "BLOCKED":
        text = (blocked or "").strip()
        if text.upper().startswith("BLOCKED:"):
            text = text[8:].strip()
        if any(p in text for p in _ROOM):
            return "transient"
        if text.lower().startswith("plan:"):
            return "plan"
        return "work"
    raw = (run or {}).get("error") or ""
    err = raw.lower()
    if _NOT_IN_PLAN.search(raw):
        return "work"
    if _SPENT.search(raw):
        return "plan_limit"
    if _OVERLOADED.search(raw) or any(p in err for p in _ERR):
        return "transient"
    return "work"


def backoff(n):
    return RETRY_BACKOFF_S[n - 1] if 1 <= n <= len(RETRY_BACKOFF_S) else None
