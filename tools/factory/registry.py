import calendar, json, time

import limits as L
import pools
import states

CAP = 50
SENT_S = 6 * 3600

STEP_NAMES = ("intake", "planning", "cutting", "plan-review", "children", "queued", "building", "review", "fixing",
              "checks", "proof", "merged", "acceptance", "done", "parked", "ended", "problem")

STEPS = {
    "job": {"waiting": "queued", "queued": "queued", "building": "building", "review_wait": "review",
            "reviewing": "review", "fix_wait": "fixing", "fixing": "fixing", "checks": "checks", "proof_wait": "proof",
            "proving": "proof", "merged": "merged", "rejected": "ended", "failed": "ended", "superseded": "ended",
            "unsolvable": "ended", "blocked": "problem", "returned": "problem"},
    "plan": {"sending": "planning", "running": "planning", "planning": "planning", "cutting": "cutting",
             "reviewing": "plan-review", "repairing": "plan-review", "planned": "planning", "replan": "planning",
             "resend": "planning", "unsent": "planning", "asked": "planning", "revise": "plan-review",
             "repair": "plan-review", "cut": "children", "blocked": "problem", "lost": "problem"},
    "recheck": {"sending": "queued", "running": "queued", "fresh": "queued", "corrected": "queued", "blocked": "problem"},
    "accept": {"running": "acceptance", "unsent": "acceptance", "no_acceptor": "acceptance", "gaps": "acceptance",
               "left": "acceptance", "accepted": "done", "closed": "done"},
    "instr": {"review": "intake", "unsent": "intake", "unreadable": "intake", "refused": "intake", "rejected": "ended",
              "applied": "done"},
}

BACK_MOVES = {("reviewing", "fix_wait"), ("checks", "fix_wait"), ("checks", "review_wait"), ("proving", "fix_wait"),
              ("proving", "checks")}
KV_STATUS = {
    "plan": {"sending": "taken", "running": "taken", "planning": "taken", "cutting": "taken", "reviewing": "taken",
             "repairing": "taken", "planned": "sent", "replan": "sent", "resend": "sent", "unsent": "sent",
             "revise": "back", "repair": "back", "asked": "with-owner", "lost": "lost"},
    "recheck": {"sending": "taken", "running": "taken"},
    "accept": {"running": "taken", "no_acceptor": "sent", "gaps": "back", "left": "refused"},
    "instr": {"review": "taken", "unsent": "sent", "unreadable": "refused", "refused": "refused"},
}
KEYS = ("state", "started", "why", "name", "agent", "sends", "run", "fire")
LIVE_KV = {"plan": set(STEPS["plan"]) - {"cut", "blocked", "lost"}, "recheck": {"sending", "running"},
           "accept": set(STEPS["accept"]) - {"accepted", "closed", "gaps", "left"}, "instr": {"review", "unsent"}}


def iso(v):
    if v in (None, ""):
        return None
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(v)))
    except (TypeError, ValueError):
        return str(v)


def epoch(v):
    try:
        return calendar.timegm(time.strptime(v, "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return None


def read(store):
    db = store.db
    jobs = {r["job"]: r for r in (dict(x) for x in db.execute("SELECT job, state, data, updated_at FROM jobs"))}
    moved = {r["job"]: dict(r) for r in db.execute(
        "SELECT t.job, t.at, t.from_state, t.to_state FROM transitions t JOIN (SELECT job, MAX(id) id FROM transitions "
        "WHERE from_state IS NULL OR from_state != to_state GROUP BY job) m ON t.id = m.id")}
    fires = {r["job"]: r["status"] for r in db.execute(
        "SELECT f.job, f.status FROM fires f JOIN (SELECT job, MAX(id) id FROM fires GROUP BY job) m ON f.id = m.id")}
    kv = {}
    keys = ",".join("'%s'" % k for k in KEYS)
    for r in db.execute("SELECT job, k, v FROM kv WHERE k IN (%s) AND (job LIKE 'plan:%%' OR job LIKE 'recheck:%%' "
                        "OR job LIKE 'accept:%%' OR job LIKE 'instr:%%' OR job LIKE 'classify:%%')" % keys):
        kv.setdefault(r["job"], {})[r["k"]] = r["v"]
    sent = [int(r["fire"]) for job, r in kv.items() if job.startswith("classify:") and r.get("run") and str(r.get("fire", "")).isdigit()]
    if sent:
        q = ",".join("?" * len(sent))
        at = {r["id"]: r["intent_at"] for r in db.execute("SELECT id, intent_at FROM fires WHERE id IN (%s)" % q, sent)}
        for job, r in kv.items():
            if job.startswith("classify:") and str(r.get("fire", "")).isdigit():
                r["sent_at"] = at.get(int(r["fire"]))
    stamps = {r["job"]: dict(r) for r in db.execute("SELECT job, state, prev, at FROM moves")}
    return {"jobs": jobs, "moved": moved, "fires": fires, "kv": kv, "moves": stamps}


def job_row(job, j, data):
    d = json.loads(j["data"] or "{}")
    state = j["state"]
    m = data["moved"].get(job) or {}
    hand = None
    if state not in states.END:
        frm = m.get("from_state")
        if state in states.RUNNING:
            status = "lost" if data["fires"].get(job) == "lost" else "taken"
        elif (frm, state) in BACK_MOVES:
            status = "back"
        elif frm in states.RUNNING and states.BACK.get(frm) == state:
            status = "retry"
        else:
            status = "sent"
        hand = {"status": status, "from": frm, "to": state, "since": m.get("at") or j["updated_at"],
                "why": d.get("wait_reason") or d.get("reason"), "by": d.get("agent")}
    return {"issue": job, "station": "job", "state": state, "step": STEPS["job"][state], "handover": hand,
            "live": state not in states.END}


def kv_row(station, n, rec, stamp):
    state = rec.get("state")
    if station == "classify":
        if not rec.get("run"):
            return None
        return {"issue": n, "station": station, "state": "running", "step": "intake", "live": True,
                "handover": {"status": "taken", "from": None, "to": "classify", "since": rec.get("sent_at"), "why": None, "by": None}}
    if state not in STEPS[station]:
        return None
    status = KV_STATUS[station].get(state)
    if station == "accept" and state == "unsent":
        status = "retry" if int(rec.get("sends") or 0) > 0 else "sent"
    hand = None
    if status:
        at, started = (stamp or {}).get("at"), iso(rec.get("started"))
        since = max(filter(None, (at, started)), default=None) if status == "taken" else (at or started)
        hand = {"status": status, "from": (stamp or {}).get("prev"), "to": state, "since": since,
                "why": rec.get("why") or None, "by": rec.get("name") or rec.get("agent")}
    return {"issue": n, "station": station, "state": state, "step": STEPS[station][state], "handover": hand,
            "live": state in LIVE_KV[station]}


ORDER = (("recheck", True), ("job", True), ("accept", True), ("plan", True), ("instr", True), ("classify", True),
         ("accept", "accepted"), ("job", False), ("accept", False), ("plan", False), ("instr", False), ("recheck", False))


def rows(data, now):
    cand = {}
    for job, j in data["jobs"].items():
        if j["state"] in STEPS["job"]:
            cand.setdefault(job, []).append(job_row(job, j, data))
    for key, rec in data["kv"].items():
        station, _, n = key.partition(":")
        r = kv_row(station, n, rec, data["moves"].get(key))
        if r:
            cand.setdefault(n, []).append(r)
    rank = {k: i for i, k in enumerate(ORDER)}
    out = []
    for n, rs in cand.items():
        out.append(min(rs, key=lambda r: rank.get((r["station"], "accepted" if r["station"] == "accept" and r["state"] == "accepted" else r["live"]), len(ORDER))))
    return sorted(out, key=lambda r: (len(r["issue"]), r["issue"]))


def stuck(r, now, cfg):
    h = r.get("handover") or {}
    status = h.get("status")
    if status in ("lost", "refused", "with-owner"):
        return True
    since, at = epoch(h.get("since")), epoch(now)
    if since is None or at is None:
        return False
    limits = cfg.get("registry") or {}
    if status == "sent" and r.get("state") not in states.SLOW_WAIT:
        return at - since > limits.get("sent_s", SENT_S)
    if status == "taken":
        return at - since > L.run_limits(cfg.get("clocks"))["run_limit_s"]
    return False


def brief(r, names):
    h = r.get("handover") or {}
    return {"issue": r["issue"], "step": r["step"], "station": r["station"], "status": h.get("status"),
            "since": h.get("since"), "by": names.get(h.get("by"), h.get("by")), "why": (h.get("why") or "")[:120] or None}


def summary(rs, now, cfg):
    names = pools.names(cfg) if cfg.get("types") else {}
    steps = {}
    for r in rs:
        steps[r["step"]] = steps.get(r["step"], 0) + 1
    newest = sorted(rs, key=lambda r: (r.get("handover") or {}).get("since") or "", reverse=True)
    hung = [brief(r, names) for r in newest if stuck(r, now, cfg)]
    flagged = {h["issue"] for h in hung[:CAP]}
    taken = [brief(r, names) for r in rs if (r.get("handover") or {}).get("status") == "taken" and r["issue"] not in flagged]
    return {"steps": steps, "stuck": hung[:CAP], "stuck_more": max(0, len(hung) - CAP),
            "taken": taken[:CAP], "taken_more": max(0, len(taken) - CAP)}
