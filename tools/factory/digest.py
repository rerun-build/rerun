import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutshape
import limits as L
import states
import tokenstats

STATIONS = (("build", "queued", "building"), ("review", "review_wait", "reviewing"),
            ("fix", "fix_wait", "fixing"), ("proof", "proof_wait", "proving"))
SERVICE_WINDOW_S = 2 * 3600
MAX_THREADS = 50
MAX_BLOCKED = 20
PROOF_WINDOW_S = 86400
PROOF_MIN = 4
PROOF_RATE = 0.5
BURN_WINDOW_S = 3600
MAX_ANOMALIES = 50
MEASURE_WINDOW_S = 86400
BLOCK_STATES = ("blocked", "rejected", "failed", "returned")
MARK = "<!-- factory-digest -->"
POST_EVERY_S = 600
CONTROL_TITLE = "factory control"


def stations(store, now):
    jobs = store.jobs()
    rows = {str(j["issue"]): [t for t in store.transitions_of(str(j["issue"])) if t["from_state"] != t["to_state"]] for j in jobs}
    out = []
    for name, wait, run in STATIONS:
        waits = []
        for j in jobs:
            if j["state"] == wait:
                last = rows[str(j["issue"])]
                waits.append(int(now - L.ts(last[-1]["at"] if last else j["updated_at"])))
        spans = []
        for seq in rows.values():
            for i, t in enumerate(seq):
                if t["from_state"] != run or now - L.ts(t["at"]) > SERVICE_WINDOW_S:
                    continue
                starts = [L.ts(u["at"]) for u in seq[:i] if u["to_state"] == run]
                if starts:
                    spans.append(L.ts(t["at"]) - starts[-1])
        out.append({"station": name, "queue": len(waits), "oldestWaitS": max(waits, default=0),
                    "serviceS": sum(spans) / len(spans) if spans else None,
                    "inUse": sum(1 for j in jobs if j["state"] == run)})
    return out


def threads(store):
    groups = {}
    for j in store.jobs():
        p = cutshape.parse({"number": j["issue"], "body": j.get("body") or ""})
        if p["parent"] is not None:
            groups.setdefault(p["parent"], {})[j["issue"]] = (j["state"], p["deps"])
    out = []
    for parent, jobs in groups.items():
        live = {n: [d for d in deps if d in jobs and jobs[d][0] != "merged"] for n, (state, deps) in jobs.items() if state != "merged"}
        if not live:
            continue
        def walk(n, path):
            best = 0
            for d in live[n]:
                if d not in path:
                    best = max(best, walk(d, path | {n}))
            return best + 1

        chain = max(walk(n, frozenset()) for n in live)
        out.append({"parent": parent, "done": sum(1 for s, _ in jobs.values() if s == "merged"), "total": len(jobs),
                    "chain": chain, "blockedBy": sorted(n for n, (s, _) in jobs.items() if s in states.PROBLEM)[:MAX_BLOCKED]})
    return sorted(out, key=lambda t: t["parent"])[-MAX_THREADS:]


def anomalies(store, cfg, now):
    limit = L.run_limits(cfg.get("clocks"))["run_limit_s"]
    clock, repeat = [], []
    failed = passed = 0
    for j in sorted(store.jobs(), key=lambda j: int(j["issue"])):
        issue = int(j["issue"])
        rows = [t for t in store.transitions_of(str(j["issue"])) if t["from_state"] != t["to_state"]]
        if j["state"] in states.RUNNING:
            age = int(now - L.ts(rows[-1]["at"] if rows else j["updated_at"]))
            if age > limit:
                clock.append({"kind": "past_clock", "issue": issue, "detail": "%s for %d s, limit %d s" % (j["state"], age, limit)})
        if j["state"] not in states.END:
            reasons = [t["reason"] for t in rows if t["reason"]]
            if len(reasons) >= 2 and reasons[-1] == reasons[-2]:
                repeat.append({"kind": "repeat_block", "issue": issue, "detail": reasons[-1][:200]})
    for j in store.jobs():
        for t in store.transitions_of(str(j["issue"])):
            if t["from_state"] == "proving" and now - L.ts(t["at"]) <= PROOF_WINDOW_S:
                if t["to_state"] == "fix_wait":
                    failed += 1
                elif t["to_state"] == "checks":
                    passed += 1
    out = clock + repeat
    total = failed + passed
    if total >= PROOF_MIN and failed / total >= PROOF_RATE:
        out.append({"kind": "proof_fail_rate", "issue": None, "detail": "%d of %d proofs failed in 24 h" % (failed, total)})
    cap = cfg.get("budget_tokens_per_hour")
    if isinstance(cap, (int, float)) and not isinstance(cap, bool) and cap > 0:
        used = sum((r[0] or 0) + (r[1] or 0) for r in store.db.execute("SELECT tokens_in, tokens_out, intent_at FROM fires")
                   if 0 <= now - L.ts(r[2]) <= BURN_WINDOW_S)
        if used > cap:
            out.append({"kind": "budget_burn", "issue": None, "detail": "%d tokens in the last hour, budget %s" % (used, cap)})
    return out[:MAX_ANOMALIES]


def measures(store, now):
    merged = []
    blocks = {k: 0 for k in BLOCK_STATES}
    for j in store.jobs():
        rows = [t for t in store.transitions_of(str(j["issue"])) if t["from_state"] != t["to_state"]]
        for t in rows:
            if t["to_state"] in blocks and 0 <= now - L.ts(t["at"]) <= MEASURE_WINDOW_S:
                blocks[t["to_state"]] += 1
        into = [t for t in rows if t["to_state"] == "merged"]
        if j["state"] == "merged" and into and 0 <= now - L.ts(into[-1]["at"]) <= MEASURE_WINDOW_S:
            merged.append((str(j["issue"]), L.ts(into[-1]["at"]) - L.ts(rows[0]["at"]),
                           sum(1 for t in rows if t["to_state"] == "fix_wait")))
    n = len(merged)
    tokens = 0
    parents = set()
    for job, _, _ in merged:
        row = store.db.execute("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM fires WHERE job=?", (job,)).fetchone()
        tokens += row[0]
        found = store.get_job(job)
        parent = cutshape.parse({"number": int(job), "body": found.get("body")})["parent"] if found and job.isdigit() else None
        if parent is not None:
            parents.add(parent)
    for parent in sorted(parents):
        row = store.db.execute("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM fires WHERE job=?", ("plan:%d" % parent,)).fetchone()
        tokens += row[0]
    return {"mergedPerHour": round(n / 24, 2), "leadTimeS": sum(m[1] for m in merged) / n if n else None,
            "firstPassYield": sum(1 for m in merged if m[2] == 0) / n if n else None,
            "fixRounds": sum(m[2] for m in merged) / n if n else None,
            "blocks": blocks, "tokensPerMerged": tokens / n if n else None}


def planners(store, now):
    jobs = []
    for j in store.jobs():
        rows = [t for t in store.transitions_of(str(j["issue"])) if t["from_state"] != t["to_state"]]
        if not rows:
            continue
        parent = cutshape.parse({"number": int(j["issue"]), "body": j.get("body")})["parent"] if str(j["issue"]).isdigit() else None
        jobs.append({"parent": parent, "first": L.ts(rows[0]["at"]), "states": [t["to_state"] for t in rows],
                     "state": j["state"], "replans": j.get("replans") or 0})
    fires = []
    for r in store.db.execute("SELECT job, coworker, intent_at FROM fires WHERE stage='plan' AND job LIKE 'plan:%'"):
        number = r[0].split(":", 1)[1]
        if number.isdigit():
            fires.append({"parent": int(number), "coworker": r[1], "at": L.ts(r[2])})
    return tokenstats.planners(jobs, fires, now)


def build(store, cfg, now):
    return {"stations": stations(store, now), "threads": threads(store),
            "anomalies": anomalies(store, cfg, now), "measures": measures(store, now), "planners": planners(store, now)}


def block(d):
    return MARK + "\n```json\n" + json.dumps(d, sort_keys=True) + "\n```"


def post(gh, store, repo, d, now):
    try:
        if d is None:
            return False
        last = store.get_all("-").get("digest_at")
        if last is not None and now - float(last) < POST_EVERY_S:
            return False
        store.set("-", "digest_at", now)
        rows = json.loads(gh(["issue", "list", "-R", repo, "--state", "open", "--search",
                              "Factory control in:title", "--json", "number,title"]))
        number = next((r["number"] for r in rows if str(r["title"]).strip().lower() == CONTROL_TITLE), None)
        if number is None:
            return False
        body = "body=" + block(d)
        held = store.get_all("-").get("digest_comment", "")
        if held.startswith("%d:" % number):
            try:
                gh(["api", "-X", "PATCH", "repos/%s/issues/comments/%s" % (repo, held.split(":", 1)[1]), "-f", body])
                return True
            except Exception:
                pass
        made = json.loads(gh(["api", "-X", "POST", "repos/%s/issues/%d/comments" % (repo, number), "-f", body]))
        store.set("-", "digest_comment", "%d:%s" % (number, made["id"]))
        return True
    except Exception:
        return False
