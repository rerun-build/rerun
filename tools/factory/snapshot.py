import datetime
import json

import cutshape
import pools
import states
import store as ledger_store

RUNNING = states.RUNNING
END = states.END
WAIT_STATES = states.WAIT_STATES
TYPES = ("coder", "reviewer", "researcher", "designer")
MAX_JOBS = 300
MAX_EPICS = 50
MAX_READS = 5
KINDS = ("feature", "review_fix", "fix", "upgrade", "refactor", "research", "other")
DEPARTMENTS = (
    ("docs/research", "design"), ("supabase", "database"), ("apps/engine", "engine"),
    ("apps/ui/app/api", "backend"), ("packages/contracts", "backend"),
    ("apps/ui", "frontend"), ("packages/ui", "frontend"), ("packages/i18n", "frontend"),
    ("tools/factory", "tooling"), (".github", "tooling"), ("deploy", "tooling"), ("docs", "docs"),
)
MAX_BYTES = 256 * 1024
MAX_PLANS = 5
MAX_RUNS = 8


def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _cut(text, n):
    return None if text is None else str(text)[:n]


def _clamp(v, lo, hi):
    return max(lo, min(hi, int(v)))


def _entered(store, j):
    rows = store.transitions_of(str(j["issue"]))
    changed = [r for r in rows if r["from_state"] != r["to_state"]]
    if changed:
        return changed[-1]["at"]
    return rows[0]["at"] if rows else (j.get("updated_at") or ledger_store.now())


def _reason(j):
    state = j["state"]
    if state in END:
        text = j.get("reason")
    elif state == "waiting":
        text = "waits on " + ", ".join("#%d" % d for d in j["waiting"]) if j.get("waiting") else j.get("wait_reason")
    elif state in WAIT_STATES:
        text = j.get("wait_reason")
    else:
        text = None
    return _cut(text or None, 300)


def _department(paths):
    count = {}
    for p in paths:
        for prefix, dept in DEPARTMENTS:
            if p == prefix or p.startswith(prefix + "/"):
                count[dept] = count.get(dept, 0) + 1
                break
    order = []
    for _, dept in DEPARTMENTS:
        if dept in count and dept not in order:
            order.append(dept)
    if not order:
        return None, []
    main = max(order, key=lambda d: (count[d], -order.index(d)))
    return main, [d for d in order if d != main]


def _kind(title, labels):
    for lab in labels or []:
        name = str((lab or {}).get("name") or "").lower().replace("-", "_")
        if name in KINDS:
            return name
    t = str(title or "").lower()
    if "review" in t and "fix" in t:
        return "review_fix"
    for word in ("fix", "upgrade", "refactor", "research", "feature"):
        if word in t:
            return word
    return "other"


def _epic(store, n, read_epic, budget):
    row = store.db.execute("SELECT v FROM kv WHERE job='-' AND k=?", ("epic:%d" % n,)).fetchone()
    if row:
        try:
            c = json.loads(row[0])
            return str(c["title"])[:256], c["kind"]
        except (ValueError, KeyError, TypeError):
            pass
    if read_epic is not None and budget[0] > 0:
        budget[0] -= 1
        try:
            r = read_epic(n)
            title = str(r["title"])[:256]
            kind = _kind(title, r.get("labels"))
            store.set("-", "epic:%d" % n, json.dumps({"title": title, "kind": kind}))
            return title, kind
        except Exception:  # noqa: BLE001 - an unreadable epic keeps its number
            pass
    return "#%d" % n, "other"


def _epics(store, kept, read_epic):
    live, rest = set(), set()
    for j in kept:
        p = cutshape.parse({"number": j["issue"], "body": j.get("body") or ""}).get("parent")
        if p is not None:
            (live if j["state"] not in END else rest).add(p)
    chosen = (sorted(live, reverse=True) + sorted(rest - live, reverse=True))[:MAX_EPICS]
    budget = [MAX_READS]
    out = []
    for n in sorted(chosen):
        title, kind = _epic(store, n, read_epic, budget)
        out.append({"issue": n, "title": title, "kind": kind})
    return out


def _job(store, cfg, names, j):
    running = j["state"] in RUNNING
    parsed = cutshape.parse({"number": j["issue"], "body": j.get("body") or ""})
    steps = None
    if running and j.get("fire_id") is not None:
        row = store.db.execute("SELECT steps FROM fires WHERE id=?", (j["fire_id"],)).fetchone()
        steps = row[0] if row else None
    rnd = j.get("round")
    history = [{"state": r["to_state"], "at": r["at"], "reason": _cut(r["reason"], 300), "runId": _cut(r["run_id"], 64)}
               for r in store.transitions_of(str(j["issue"])) if r["from_state"] != r["to_state"]][-30:]
    ids = {n: i for i, n in names.items()}
    rows = store.db.execute("SELECT stage, coworker, status, intent_at, ended_at, tokens_in, tokens_out, run_id "
                            "FROM fires WHERE job=? ORDER BY id", (str(j["issue"]),)).fetchall()[-12:]
    runs = [{"stage": _cut(r[0], 20), "coworkerId": ids.get(r[1]) or _cut(r[1], 64), "status": _cut(r[2], 20),
             "startedAt": r[3], "endedAt": r[4], "tokensIn": int(r[5] or 0), "tokensOut": int(r[6] or 0),
             "runId": _cut(r[7], 64)} for r in rows]
    main, others = _department(parsed.get("paths") or [])
    job = {
        "issue": j["issue"], "title": str(j.get("title") or "")[:256], "state": j["state"],
        "enteredAt": _entered(store, j), "pr": j.get("pr"),
        "round": rnd if isinstance(rnd, int) and 1 <= rnd <= 9 else None,
        "coworker": names.get(j.get("agent")) if running else None,
        "copy": j.get("copy") if running else None,
        "steps": steps, "tokensIn": None, "tokensOut": None,
        "parent": parsed.get("parent"), "dependsOn": list(parsed.get("deps") or [])[:20],
        "reason": _reason(j), "history": history, "runs": runs,
    }
    if "closed_seen" in store.get_all(str(j["issue"])):
        job["closedOutside"] = True
    if main:
        job["department"] = main
        if others:
            job["departments"] = others
    return job


def _plan(p):
    runs = [{"id": str(c["id"])[:64], "name": str(c["name"])[:64], "runId": str(c["runId"])[:64], "startedAt": c["startedAt"],
             "steps": None if c.get("steps") is None else max(0, int(c["steps"]))} for c in p["coworkers"][:MAX_RUNS]]
    return {"parent": None if p["parent"] is None else int(p["parent"]), "title": str(p["title"])[:256], "coworkers": runs,
            "children": max(0, int(p["children"])), "filed": max(0, int(p["filed"]))}


def _size(v):
    return len(json.dumps(v, separators=(",", ":")).encode())


def _fit(snap):
    total = _size(snap)
    if total <= MAX_BYTES:
        return snap
    jobs = snap["jobs"]
    cost = {id(j): _size([j["history"], j["runs"]]) for j in jobs}
    empty = _size([[], []])
    order = sorted(jobs, key=lambda j: (j["state"] not in END, j["enteredAt"]))
    for j in order:
        if total <= MAX_BYTES:
            break
        total -= cost[id(j)] - empty
        j["history"], j["runs"] = [], []
    return snap


def build_snapshot(store, cfg, now, holds_active, beat=0, read_epic=None, planning=None):
    names = pools.names(cfg)
    all_jobs = store.jobs()
    live = [j for j in all_jobs if j["state"] not in END]
    ended = sorted((j for j in all_jobs if j["state"] in END), key=lambda j: str(j.get("updated_at") or ""), reverse=True)
    kept = sorted(live + ended[:max(0, MAX_JOBS - len(live))], key=lambda j: int(j["issue"]))[:MAX_JOBS]
    out = {}
    for j in all_jobs:
        if j["state"] in RUNNING and j.get("agent"):
            out[j["agent"]] = out.get(j["agent"], 0) + 1
    pool_list = []
    for t, v in pools.types(cfg).items():
        if t in TYPES and len(pool_list) < 8:
            pool_list.append({"type": t, "coworkers": [
                {"name": c["name"][:64], "id": c["id"][:64], "runs": _clamp(c["runs"], 1, 32), "out": _clamp(out.get(c["id"], 0), 0, 32)}
                for c in v["coworkers"][:20]]})
    today = ledger_store.now()[:10]
    ended_today = {s: 0 for s in ("merged", "rejected", "blocked", "failed", "returned")}
    for j in all_jobs:
        if j["state"] in ended_today and str(j.get("updated_at") or "").startswith(today):
            ended_today[j["state"]] += 1
    holds_list = [{"kind": holds_active["kind"][:40], "until": iso(holds_active["until"])}] if holds_active else []
    snap = {"version": 1, "madeAt": iso(now), "beat": beat, "repo": cfg["repo"],
            "jobs": [_job(store, cfg, names, j) for j in kept], "holds": holds_list, "pools": pool_list,
            "endedToday": ended_today, "epics": _epics(store, kept, read_epic)}
    if planning:
        snap["planning"] = [_plan(p) for p in planning[:MAX_PLANS]]
    return _fit(snap)
