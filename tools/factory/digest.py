import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import causes as failure_causes
import changelog
import cutshape
import limits as L
import states
import tokenstats
import weights

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
REWORK_LAST = 20
REWORK_DEFAULT = 1.3
CONTROL_BOUNDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "control-bounds.json")
BLOCK_STATES = ("blocked", "rejected", "failed", "returned", "unsolvable")
WITHDRAWN = "issue closed or the "
SENIOR = "senior round: "
MARK = "<!-- factory-digest -->"
POST_EVERY_S = 600
CONTROL_TITLE = "factory control"
CAUSE_WINDOW_S = 7 * 86400
MAX_GROUPS = 20
MAX_CHANGES = 20


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


def solved_green(store):
    done = []
    for j in store.jobs():
        if j["state"] != "merged" or j.get("dev_result") != "green":
            continue
        into = [t for t in store.transitions_of(str(j["issue"])) if t["to_state"] == "merged"]
        if into:
            done.append((L.ts(into[-1]["at"]), str(j["issue"])))
    return [job for _, job in sorted(done)[-REWORK_LAST:]]


def rework(store, table):
    jobs = solved_green(store)
    if not jobs:
        return None, None, []
    runs = units = 0.0
    extra = {}
    for job in jobs:
        rows = store.db.execute("SELECT stage, model, tokens_in, tokens_out, cache_read, cache_write FROM fires "
                                "WHERE job=? AND (stage LIKE 'build%' OR stage LIKE 'fix%')", (job,)).fetchall()
        runs += len(rows)
        units += sum(weights.units(dict(r), table)[0] for r in rows)
        parent = cutshape.parse({"number": int(job), "body": store.get_job(job).get("body") or ""})["parent"]
        key = "plan:%d" % parent if parent is not None else "-"
        extra[key] = extra.get(key, 0) + len(rows) - 1
    top = sorted(((k, v) for k, v in extra.items() if v > 0), key=lambda kv: (-kv[1], kv[0]))[:3]
    return runs / len(jobs), units / len(jobs), top


def rework_threshold(cfg):
    with open(CONTROL_BOUNDS, encoding="utf-8") as f:
        bound = json.load(f)["rework_threshold"]
    setting = cfg.get("rework_threshold")
    if not isinstance(setting, (int, float)) or isinstance(setting, bool) or setting <= 0:
        setting = REWORK_DEFAULT
    return min(setting, bound)


def alarm(store, d, now):
    hit = [a for a in ((d or {}).get("anomalies") or []) if a.get("kind") == "rework"]
    if not hit:
        return
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    if store.get_all("-").get("rework_day") == day:
        return
    store.set("-", "rework_day", day)
    store.add_failure("rework", "-", station="plan", reason=hit[0]["detail"])


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
    runs, units, top = rework(store, weights.load())
    threshold = rework_threshold(cfg)
    if runs is not None and runs > threshold:
        most = ", ".join("%s +%d" % (k, v) for k, v in top) or "-"
        out.append({"kind": "rework", "issue": None, "detail": ("%.1f build and fix runs (%.2f cost units) per issue solved green, "
                                                              "last %d, threshold %s; most extra: %s" % (runs, units, REWORK_LAST, threshold, most))[:200]})
    cap = cfg.get("budget_tokens_per_hour")
    if isinstance(cap, (int, float)) and not isinstance(cap, bool) and cap > 0:
        used = sum((r[0] or 0) + (r[1] or 0) for r in store.db.execute("SELECT tokens_in, tokens_out, intent_at FROM fires")
                   if 0 <= now - L.ts(r[2]) <= BURN_WINDOW_S)
        if used > cap:
            out.append({"kind": "budget_burn", "issue": None, "detail": "%d tokens in the last hour, budget %s" % (used, cap)})
    return out[:MAX_ANOMALIES]


def measures(store, now, table=None):
    merged = []
    blocks = {k: 0 for k in BLOCK_STATES}
    escalated = escalated_merged = 0
    in_window, ever = {}, {}
    for j in store.jobs():
        rows = [t for t in store.transitions_of(str(j["issue"])) if t["from_state"] != t["to_state"]]
        for t in rows:
            if t["to_state"] in blocks and WITHDRAWN not in str(t["reason"] or "") and 0 <= now - L.ts(t["at"]) <= MEASURE_WINDOW_S:
                blocks[t["to_state"]] += 1
        into = [t for t in rows if t["to_state"] == "merged"]
        up = [t for t in rows if str(t["reason"] or "").startswith(SENIOR) and 0 <= now - L.ts(t["at"]) <= MEASURE_WINDOW_S]
        if up:
            escalated += 1
            escalated_merged += j["state"] == "merged" and bool(into) and L.ts(into[-1]["at"]) >= L.ts(up[-1]["at"])
        parent = None
        if j["state"] == "merged" and str(j["issue"]).isdigit():
            parent = cutshape.parse({"number": int(j["issue"]), "body": j.get("body")})["parent"]
            if parent is not None:
                ever[parent] = ever.get(parent, 0) + 1
        if j["state"] == "merged" and into and 0 <= now - L.ts(into[-1]["at"]) <= MEASURE_WINDOW_S:
            merged.append((str(j["issue"]), L.ts(into[-1]["at"]) - L.ts(rows[0]["at"]),
                           sum(1 for t in rows if t["to_state"] == "fix_wait")))
            if parent is not None:
                in_window[parent] = in_window.get(parent, 0) + 1
    n = len(merged)
    tokens = 0
    for job, _, _ in merged:
        row = store.db.execute("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM fires WHERE job=?", (job,)).fetchone()
        tokens += row[0]
    for parent in sorted(in_window):
        row = store.db.execute("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM fires WHERE job=?", ("plan:%d" % parent,)).fetchone()
        tokens += row[0] * in_window[parent] / ever[parent]
    runs, units, _ = rework(store, weights.load() if table is None else table)
    return {"mergedPerHour": round(n / 24, 2), "leadTimeS": sum(m[1] for m in merged) / n if n else None,
            "firstPassYield": sum(1 for m in merged if m[2] == 0) / n if n else None,
            "fixRounds": sum(m[2] for m in merged) / n if n else None,
            "blocks": blocks, "tokensPerMerged": tokens / n if n else None,
            "escalated": escalated, "escalatedMerged": escalated_merged,
            "reworkPerSolved": None if runs is None else round(runs, 4),
            "reworkUnitsPerSolved": None if units is None else round(units, 4)}


def planners(store, now):
    jobs = []
    for r in store.db.execute("SELECT job, at FROM transitions WHERE id IN (SELECT MIN(id) FROM transitions WHERE from_state IS NOT to_state GROUP BY job)"):
        if not 0 <= now - L.ts(r[1]) <= tokenstats.PLANNER_WINDOW_S:
            continue
        j = store.get_job(r[0])
        if j is None:
            continue
        rows = [t for t in store.transitions_of(r[0]) if t["from_state"] != t["to_state"]]
        parent = cutshape.parse({"number": int(j["issue"]), "body": j.get("body")})["parent"] if str(j["issue"]).isdigit() else None
        jobs.append({"parent": parent, "first": L.ts(rows[0]["at"]), "states": [t["to_state"] for t in rows],
                     "state": j["state"], "replans": j.get("replans") or 0})
    keys = sorted({"plan:%d" % j["parent"] for j in jobs if j["parent"] is not None})
    fires = []
    if keys:
        marks = ",".join("?" * len(keys))
        for r in store.db.execute("SELECT job, coworker, intent_at FROM fires WHERE stage='plan' AND job IN (%s)" % marks, keys):
            number = r[0].split(":", 1)[1]
            if number.isdigit():
                fires.append({"parent": int(number), "coworker": r[1], "at": L.ts(r[2])})
    return tokenstats.planners(jobs, fires, now)


def fire_rows(store):
    return [dict(r) for r in store.db.execute(
        "SELECT stage, model, thinking, tokens_in, tokens_out, cache_read, cache_write, intent_at FROM fires")]


def priced_fires(store, table):
    out = []
    for r in fire_rows(store):
        units, _ = weights.units(r, table)
        out.append({"at": L.ts(r["intent_at"]), "tokens": (r["tokens_in"] or 0) + (r["tokens_out"] or 0), "units": units,
                    "stage": r["stage"], "model": r["model"], "thinking": r["thinking"]})
    return out


def bar(store, now, table=None):
    jobs = []
    for j in store.jobs():
        if j["state"] != "merged":
            continue
        rows = [t for t in store.transitions_of(str(j["issue"])) if t["from_state"] != t["to_state"]]
        into = [t for t in rows if t["to_state"] == "merged"]
        if not into:
            continue
        jobs.append({"job": str(j["issue"]), "merged_at": L.ts(into[-1]["at"]), "dev_result": j.get("dev_result"),
                     "fix_rounds": sum(1 for t in rows if t["to_state"] == "fix_wait"), "replans": j.get("replans") or 0})
    fires = priced_fires(store, table)
    escaped = []
    for raw in store.get_all("escaped").values():
        try:
            rec = json.loads(raw)
            at = rec["at"]
            escaped.append({"job": str(rec["job"]), "at": at if isinstance(at, (int, float)) else L.ts(at)})
        except Exception:
            continue
    return tokenstats.bar(jobs, fires, escaped, now)


def station(stage):
    words = (stage or "").split()
    return words[0] if words else "unknown"


def split_rows(fires, name_of, solved, cut):
    groups = {}
    for f in fires:
        g = groups.setdefault(name_of(f), [0, 0, 0.0])
        g[0] += 1
        g[1] += f["tokens"]
        g[2] += f["units"]
    return [{"name": name, "runs": runs, "tokens": tokens, "units": round(units, 4),
             "unitsPerIssue": round(units / solved, 4) if solved else None}
            for name, (runs, tokens, units) in sorted(groups.items())][:cut]


def read_plan_reading(store):
    try:
        kept = json.loads(store.get_all("-").get("plan_reading") or "null")
    except ValueError:
        return None
    ok = isinstance(kept, dict) and isinstance(kept.get("day"), str) and isinstance(kept.get("at"), (int, float)) \
        and isinstance(kept.get("pct"), (int, float))
    return kept if ok else None


def calibration(store, now, plan, fires):
    uncalibrated = {"state": "uncalibrated", "unitsPerPlanPercent": None}
    pct = plan.get("weekUsedPercent") if isinstance(plan, dict) else None
    if not isinstance(pct, (int, float)) or isinstance(pct, bool):
        return uncalibrated
    today = time.strftime("%Y-%m-%d", time.gmtime(now))
    kept = read_plan_reading(store)
    if kept is None or kept["day"] != today or pct < kept["pct"]:
        store.set("-", "plan_reading", json.dumps({"day": today, "at": now, "pct": pct}))
        return uncalibrated
    if pct <= kept["pct"]:
        return uncalibrated
    units = sum(f["units"] for f in fires if f["at"] >= kept["at"])
    return {"state": "calibrated", "unitsPerPlanPercent": round(units / (pct - kept["pct"]), 4)}


def cost(store, now, table, plan):
    fires = [f for f in priced_fires(store, table) if 0 <= now - f["at"] <= MEASURE_WINDOW_S]
    solved = bar(store, now, table)["day"]["solvedGreen"]
    total = sum(f["units"] for f in fires)
    models = (table or {}).get("models") or {}
    return {"perIssue": round(total / solved, 4) if solved else None,
            "byStation": split_rows(fires, lambda f: station(f["stage"]), solved, 12),
            "byModel": split_rows(fires, lambda f: f["model"] or "unknown", solved, 12),
            "byThinking": split_rows(fires, lambda f: f["thinking"] or "none", solved, 6),
            "unweighed": sorted({f["model"] or "unknown" for f in fires} - set(models))[:12],
            "calibration": calibration(store, now, plan, fires)}


def causes(store, now):
    at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    ended = failure_causes.ended_jobs(store)
    jobs = changelog.before(ended, at)
    events = failure_causes.grouped(store)
    recent = {}
    for f in store.failures():
        if 0 <= now - L.ts(f["at"]) <= CAUSE_WINDOW_S:
            recent.setdefault(failure_causes.group(f), []).append(f)
    ranked = sorted(recent.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:MAX_GROUPS]
    groups = []
    for name, rows in ranked:
        rate = changelog.rate(events, jobs, name)
        groups.append({"group": name[:80], "events": len(rows), "rate": rate, "state": group_state(store, name)})
    changes = [{"issue": c["issue"], "group": c["grp"][:80], "kind": c["kind"], "before": c["before"],
                "after": c["after"], "verdict": c["verdict"], "revert": c["revert"]}
               for c in store.changes()[-MAX_CHANGES:]]
    return {"groups": groups, "changes": changes}


def group_state(store, name):
    rows = [c for c in store.changes() if c["grp"] == name]
    if not rows or rows[-1]["verdict"] in ("revert", "dropped"):
        return "open"
    if rows[-1]["verdict"] is None:
        return "changed"
    if rows[-1]["verdict"] == "kept":
        return "kept"
    return "open"


def issues(store, now):
    zero = {"P0": 0, "P1": 0, "P2": 0, "P3": 0, "none": 0}
    try:
        kept = json.loads(store.get_all("-").get("issues_open") or "")
        counts = {k: int(kept[k]) for k in zero}
    except (ValueError, TypeError, KeyError, AttributeError):
        counts = zero
    start = now - now % 86400

    def since(key):
        n = 0
        for r in store.db.execute("SELECT v FROM kv WHERE job LIKE 'classify:%' AND k=?", (key,)):
            try:
                n += int(r[0]) >= start
            except ValueError:
                pass
        return n

    return {"open": counts, "classifiedToday": since("at"), "joinedToday": since("joined")}


def build(store, cfg, now, plan=None):
    table = weights.load()
    return {"stations": stations(store, now), "threads": threads(store),
            "anomalies": anomalies(store, cfg, now), "measures": measures(store, now, table), "planners": planners(store, now),
            "issues": issues(store, now),
            "bar": bar(store, now, table), "causes": causes(store, now), "cost": cost(store, now, table, plan)}


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
