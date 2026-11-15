import fnmatch, json, re, time

MARK = "<!-- factory-ledger -->"
STATE_OPEN, STATE_CLOSE = "<!-- factory-state ", " -->"
STAGES = ("PLAN", "CHALLENGE", "BUILD", "TEST", "JOBPR", "REVIEW", "READY", "BLOCKED")
CHUNK_STATES = ("PENDING", "BUILD", "TEST", "MERGED")
HEAD = "| stage | chunk | coworker | run | fired | ended | status | input tokens |\n|---|---|---|---|---|---|---|---|"

CHUNK_RE = re.compile(r"\s*- \[.\] ([a-z0-9]{1,12})\.\s*([^|]*)", re.I)
FIELDS = ("builder", "test", "done-test", "paths", "max-lines", "depends on")
SUITES = ("backend", "frontend", "layout", "factory")
MAX_PATHS = 6
FULL_ID = re.compile(r"[A-Za-z_]\w*::[A-Za-z_]\w*::[A-Za-z_]\w*")


def new(issue):
    return {"v": 1, "stage": "PLAN", "chunk": None, "blocked": None, "plan_round": 1, "review_round": 0, "job_fixes": 0,
            "fired_total": 0, "job_branch": "job/%s" % issue, "pr": None, "resume_seen": 0, "chunks": {}, "runs": []}


def dump(state):
    return json.dumps(state, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e")


def cell(v):
    return "-" if v is None else str(v).replace("|", "/").replace("\n", " ").replace("<", "&lt;").replace(">", "&gt;")


def row(r):
    status = r.get("status") or ("firing" if r.get("run") is None else "-")
    vals = (r.get("stage") or r.get("slug"), r.get("chunk"), r.get("coworker"), r.get("run"), r.get("fired") or r.get("firing"),
            r.get("ended"), status, r.get("in"))
    return "| %s |" % " | ".join(cell(v) for v in vals)


def render(state, now=None):
    now = now or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    lines = [MARK, "**Factory ledger** (written by the runner; GitHub facts win over this comment)",
             "Stage: %s | chunk %s | updated %s" % (state["stage"], state.get("chunk") or "-", now),
             STATE_OPEN + dump(state) + STATE_CLOSE, HEAD] + [row(r) for r in state.get("runs", [])]
    return "\n".join(lines) + "\n"


def parse(body):
    body = (body or "").replace("\r\n", "\n")
    if not body.startswith(MARK):
        raise ValueError("not a ledger comment")
    i = body.find(STATE_OPEN)
    j = body.find(STATE_CLOSE, i + len(STATE_OPEN)) if i >= 0 else -1
    if j < 0:
        raise ValueError("ledger comment has no factory-state line")
    try:
        st = json.loads(body[i + len(STATE_OPEN):j])
    except ValueError:
        raise ValueError("ledger state is not JSON") from None
    if not isinstance(st, dict) or st.get("v") != 1 or st.get("stage") not in STAGES:
        raise ValueError("ledger state is not a v1 state")
    return st


def find(comments):
    own = [c for c in comments if (c.get("body") or "").startswith(MARK)]
    return min(own, key=lambda c: (c["created_at"], c["id"])) if own else None


def chunk_lines(text):
    out, inside = [], False
    for l in (text or "").replace("\r\n", "\n").split("\n"):
        if l.startswith("## "):
            inside = l.strip() == "## Chunks"
        elif inside and CHUNK_RE.match(l):
            out.append(l)
    return out


def fields(line):
    f = {}
    for part in line.split("|")[1:]:
        k, _, v = part.strip().partition(":")
        f[k.strip().lower()] = v.strip()
    return f


def chunk(line):
    m = CHUNK_RE.match(line or "")
    if not m:
        return None
    f, test = fields(line), fields(line).get("test", "").split()
    ml = f.get("max-lines", "")
    return {"id": m.group(1), "title": m.group(2).strip(), "builder": f.get("builder"), "suite": test[0] if test else None,
            "test": test[1] if len(test) == 2 else None, "done_test": f.get("done-test"),
            "paths": [p.strip() for p in f.get("paths", "").split(",") if p.strip()],
            "max_lines": int(ml) if ml.isdigit() else None, "depends": f.get("depends on")}


def shape(line):
    if not CHUNK_RE.match(line or ""):
        return ["not a chunk line"]
    f, c = fields(line), chunk(line)
    why = ["missing " + k for k in FIELDS if not f.get(k)]
    test = f.get("test", "").split()
    if len(test) != 2:
        why.append("test must name one suite and one test file")
    if test and test[0] not in SUITES:
        why.append("suite %s is not one of %s" % (test[0], ", ".join(SUITES)))
    for p in c["paths"]:
        if p.startswith(("/", "\\")) or re.match(r"[A-Za-z]:", p) or ".." in re.split(r"[\\/]", p):
            why.append("path not relative: " + p)
    if len(c["paths"]) > MAX_PATHS:
        why.append("more than %d paths" % MAX_PATHS)
    if c["test"] and not any(fnmatch.fnmatch(c["test"], p) for p in c["paths"]):
        why.append("test file %s is in no path" % c["test"])
    if f.get("max-lines") and c["max_lines"] is None:
        why.append("max-lines is not a number")
    dt = c["done_test"] or ""
    if dt and len(dt.split()) != 1:
        why.append("done-test is not one test id")
    elif dt and test[:1] == ["factory"] and not FULL_ID.fullmatch(dt):
        why.append("done-test is not module::Class::test")
    return why
