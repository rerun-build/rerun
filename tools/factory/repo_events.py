import roster as R

WATCHED = ("dev", "main")
STAGES = {
    "jez": "wake-jez",
    "margaret": "wake-margaret",
    "changelog_writer": "wake-changelog",
    "dana": "wake-dana",
    "issue_triage": "wake-issue-triage",
}


def behaviour(roster, files):
    if not files:
        return False
    return any(name not in R.EXEMPT for name in R.areas(roster, files))


def _wake(st, out, event, coworker, head, payload):
    if not st.add_wake(event, coworker, head):
        return
    stage = STAGES[coworker]
    out.append({
        "job": "wake:%s:%s" % (event, head),
        "stage": stage,
        "coworker": coworker,
        "payload": dict(payload, stage=stage, event=event),
    })


def wakes(st, roster, branches, merged, issues):
    out = []
    for b in branches:
        if b["branch"] in WATCHED and b["ci"] == "RED":
            _wake(st, out, "ci-red:%s" % b["branch"], "jez", b["sha"],
                  {"branch": b["branch"], "sha": b["sha"]})
    for m in merged:
        head = str(m["number"])
        if m["base"] == "main":
            _wake(st, out, "merge-main", "margaret", head,
                  {"pr": m["number"], "sha": m["sha"]})
        elif m["base"] == "dev" and behaviour(roster, m["files"]):
            payload = {"pr": m["number"], "sha": m["sha"], "files": m["files"][:50]}
            for who in ("changelog_writer", "dana"):
                _wake(st, out, "merge-dev", who, head, payload)
    for i in issues:
        if "pull_request" not in i:
            _wake(st, out, "new-issue", "issue_triage", str(i["number"]),
                  {"issue": i["number"]})
    return out
