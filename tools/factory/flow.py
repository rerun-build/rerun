import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acceptance
import cutshape
import states

TYPES = cutshape.WORKERS
REVIEW_STATES = ("review_wait", "reviewing", "proof_wait", "proving")
CONVERGENCE = {"accepted": "passed", "running": "running", "gaps": "gaps", "left": "left", "closed": "closed"}
SHOWN_FEATURES = 10
_parents = {}


def station_type(state, worker):
    if state in REVIEW_STATES:
        return "reviewer"
    return worker if worker in TYPES else "coder"


def empty_counts():
    return {t: {"ready": 0, "running": 0, "waiting": 0} for t in TYPES}


def by_type(jobs):
    counts = empty_counts()
    for j in jobs:
        state = j.get("state")
        if state in states.END or state not in states.NAMES:
            continue
        kind = "ready" if state in states.QUEUE else "running" if state in states.RUNNING else "waiting"
        counts[station_type(state, j.get("worker"))][kind] += 1
    return counts


def parent_of(job):
    issue = str(job.get("issue", ""))
    body = job.get("body") or ""
    cached = _parents.get(issue)
    if cached and cached[0] == body:
        return cached[1]
    number = int(issue) if issue.isdigit() else 0
    parent = cutshape.parse({"number": number, "body": body})["parent"]
    _parents[issue] = (body, parent)
    return parent


def convergence(parent, group, record):
    if record in (None, "unsent"):
        all_done = all(j.get("state") in acceptance.DONE for j in group)
        return "due" if all_done and parent in acceptance.due(group) else "waiting"
    return CONVERGENCE.get(record, record)


def by_feature(jobs, records, today):
    groups = {}
    for j in jobs:
        parent = parent_of(j)
        if parent:
            groups.setdefault(parent, []).append(j)
    features = []
    for parent in sorted(groups):
        group = groups[parent]
        record = records.get(parent)
        shown = (any(j.get("state") not in states.END for j in group)
                 or any(str(j.get("updated_at") or "").startswith(today) for j in group)
                 or record == "running")
        if not shown:
            continue
        features.append({
            "parent": parent,
            "done": sum(1 for j in group if j.get("state") in acceptance.DONE),
            "total": len(group),
            "convergence": convergence(parent, group, record),
        })
    return features


def beat_text(jobs, records, today):
    types = ", ".join("%s ready %d running %d waiting %d" % (t, c["ready"], c["running"], c["waiting"])
                      for t, c in by_type(jobs).items())
    features = by_feature(jobs, records, today)
    shown = ", ".join("#%d %d/%d convergence %s" % (f["parent"], f["done"], f["total"], f["convergence"])
                      for f in features[:SHOWN_FEATURES])
    if len(features) > SHOWN_FEATURES:
        shown += ", +%d more" % (len(features) - SHOWN_FEATURES)
    return "by type: %s | features: %s" % (types, shown or "none")
