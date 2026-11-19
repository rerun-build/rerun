import json, re

import planning
import states

CAP = 30
LIMIT = "1000"
PAUSED = "factory-paused"
GAPS = re.compile(r"^Gaps of #(\d+):")
END_LABEL = {"merged": "factory-done", "superseded": "factory-done", "unsolvable": "factory-unsolvable"}
LISTS = ("plan_label_no_plan", "ready_label_ended_job", "parked_but_moving", "duplicate_gaps", "ended_unlabelled")


def read(gh, repo):
    return json.loads(gh(["issue", "list", "-R", repo, "--state", "open", "--limit", LIMIT, "--json", "number,labels,title"]))


def names(i):
    return {x["name"] for x in i.get("labels") or []}


def check(issues, data, rows):
    jobs, kv = data["jobs"], data["kv"]
    moving = {r["issue"] for r in rows if r.get("station") != "job" and (r.get("handover") or {}).get("status") == "taken"}
    out = {k: [] for k in LISTS}
    waiting = 0
    gaps = {}
    for i in sorted(issues, key=lambda i: i["number"]):
        n, have = i["number"], names(i)
        j = jobs.get(str(n))
        plan = (kv.get("plan:%d" % n) or {}).get("state")
        if planning.LABEL in have and (plan is None or plan in planning.ENDED):
            out["plan_label_no_plan"].append(n)
        if PAUSED in have and str(n) in moving:
            out["parked_but_moving"].append(n)
        if planning.READY in have and j is None and PAUSED not in have:
            waiting += 1
        if j is not None and j["state"] in states.END and json.loads(j.get("data") or "{}").get("relabelled"):
            want = END_LABEL.get(j["state"], "factory-blocked")
            if planning.READY in have and want in have:
                out["ready_label_ended_job"].append(n)
            if want not in have and planning.READY not in have and PAUSED not in have and (plan is None or plan in ("blocked", "lost")):
                out["ended_unlabelled"].append({"issue": n, "want": want})
        m = GAPS.match(i.get("title") or "")
        if m:
            gaps.setdefault(int(m.group(1)), []).append(n)
    out["duplicate_gaps"] = [{"parent": p, "keep": ns[-1], "older": ns[:-1]} for p, ns in sorted(gaps.items()) if len(ns) > 1]
    out["ready_waiting"] = waiting
    out["more"] = {k: max(0, len(out[k]) - CAP) for k in LISTS}
    for k in LISTS:
        out[k] = out[k][:CAP]
    return out
