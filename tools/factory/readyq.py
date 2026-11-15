import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import limits as L


def overlap(a, b):
    return any(x == y or x.startswith(y.rstrip("/") + "/") or y.startswith(x.rstrip("/") + "/") for x in a for y in b)


def eligible(item, state):
    cfg = state.get("cfg") or {}
    busy = state.get("busy", [])
    if any(d not in state.get("merged", ()) for d in item.get("deps", [])):
        return False, "dependencies not merged"
    if len(busy) + state.get("stages", 0) >= L.capacity(cfg):
        return False, "no free slot"
    if sum(1 for j, _ in busy if j == item["job"]) >= L.per_job_cap(cfg):
        return False, "job at its per-job cap"
    if any(overlap(item.get("paths", []), l["paths"]) for l in state.get("leases", [])):
        return False, "paths under an open lease"
    if L.may_fire(state.get("fired", 0))[0] != "FIRE":
        return False, "job hit the fire cap"
    if item.get("attempts", 0) > cfg.get("retries", 1):
        return False, "attempts used"
    return True, None
