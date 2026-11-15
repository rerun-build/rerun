import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import limits as L

STATIONS = (("build", "queued", "building"), ("review", "review_wait", "reviewing"),
            ("fix", "fix_wait", "fixing"), ("proof", "proof_wait", "proving"))
SERVICE_WINDOW_S = 2 * 3600


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
