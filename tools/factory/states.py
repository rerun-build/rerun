KINDS = ("wait", "running", "end")
DEADLINES = ("stall_clock", "checks_timeout_s", "reason_only", "none")
HANDLERS = ("step", "intake")

PR_OR_BLOCKED = ({"prefix": "PR: ", "rest": "pull-url"}, {"prefix": "BLOCKED: ", "rest": "sentence"})
PUSHED_OR_BLOCKED = ({"prefix": "PUSHED: ", "rest": "sha"}, {"prefix": "BLOCKED: ", "rest": "sentence"})
VERDICT = ({"prefix": "VERDICT: ", "rest": "sentence"},)
PROOF = ({"prefix": "PROOF: ", "rest": "sentence"},)


def _row(kind, next=(), handler="step", deadline="reason_only", reason=False, queue=False, back=None, goal=(),
         problem=False, slow_wait=False):
    return {"kind": kind, "next": tuple(next), "handler": handler, "deadline": deadline, "reason": reason, "queue": queue,
            "back": back, "goal": tuple(goal), "problem": problem, "slow_wait": slow_wait}


def _end(problem, then=()):
    return _row("end", ("waiting", "queued", "review_wait") + then, None, "none", problem=problem)


TABLE = {
    "waiting": _row("wait", ("queued", "review_wait"), "intake", reason=True, slow_wait=True),
    "queued": _row("wait", ("building",), reason=True, queue=True, slow_wait=True),
    "building": _row("running", ("review_wait", "queued"), deadline="stall_clock", back="queued", goal=PR_OR_BLOCKED),
    "review_wait": _row("wait", ("reviewing", "fix_wait"), reason=True, queue=True),
    "reviewing": _row("running", ("checks", "fix_wait", "review_wait"), deadline="stall_clock", back="review_wait", goal=VERDICT),
    "fix_wait": _row("wait", ("fixing",), reason=True, queue=True),
    "fixing": _row("running", ("review_wait", "fix_wait"), deadline="stall_clock", back="fix_wait", goal=PUSHED_OR_BLOCKED),
    "checks": _row("wait", ("fix_wait", "proof_wait"), deadline="checks_timeout_s"),
    "proof_wait": _row("wait", ("proving",), reason=True, queue=True),
    "proving": _row("running", ("checks", "fix_wait", "proof_wait"), deadline="stall_clock", back="proof_wait", goal=PROOF),
    "merged": _end(False),
    "rejected": _end(True),
    "blocked": _end(True, ("merged",)),
    "failed": _end(True, ("merged",)),
    "returned": _end(True, ("merged",)),
    "superseded": _end(False),
}

NAMES = tuple(TABLE)
RUNNING = tuple(s for s in NAMES if TABLE[s]["kind"] == "running")
END = tuple(s for s in NAMES if TABLE[s]["kind"] == "end")
STAGES = tuple(s for s in NAMES if s not in END)
WAIT_STATES = tuple(s for s in NAMES if TABLE[s]["reason"])
QUEUE = tuple(s for s in NAMES if TABLE[s]["queue"])
PROBLEM = tuple(s for s in END if TABLE[s]["problem"])
SLOW_WAIT = tuple(s for s in NAMES if TABLE[s]["slow_wait"])
BACK = {s: TABLE[s]["back"] for s in RUNNING}
GOALS = {s: [dict(f) for f in TABLE[s]["goal"]] for s in RUNNING}


def allowed(old, new):
    if old not in TABLE or new not in TABLE:
        return False
    if new in END and old not in END:
        return True
    return new in TABLE[old]["next"]
