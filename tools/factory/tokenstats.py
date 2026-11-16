def shared_plan_rows(fires, keep, parents):
    children = {}
    for change in keep:
        parent = parents.get(change)
        if parent is not None:
            children.setdefault("plan:%s" % parent, []).append(change)
    rows = []
    for f in fires:
        kids = children.get(f["job"]) if isinstance(f["job"], str) else None
        if not kids:
            continue
        k = len(kids)
        for job, chunk in sorted(kids, key=str):
            row = dict(f, job=job, chunk=chunk)
            for col in ("tokens_in", "tokens_out", "cache_read"):
                if f.get(col) is not None:
                    row[col] = f[col] / k
            rows.append(row)
    return rows


def per_merged(fires, merged, key, parents=None):
    keep = set(map(tuple, merged))
    groups = {}
    rows_in = [f for f in fires if (f["job"], f["chunk"]) in keep]
    if parents:
        rows_in += shared_plan_rows(fires, keep, {tuple(c): p for c, p in parents.items()})
    for f in rows_in:
        groups.setdefault(f[key], []).append(f)
    out = {}
    for name, rows in groups.items():
        changes = len({(f["job"], f["chunk"]) for f in rows})
        cached = [f for f in rows if f.get("cache_read") is not None]
        cache_in = sum(f.get("tokens_in") or 0 for f in cached)
        cache_sum = sum(f["cache_read"] for f in cached)
        cache_changes = len({(f["job"], f["chunk"]) for f in cached})
        out[name] = {
            "changes": changes,
            "tokens_in": sum(f.get("tokens_in") or 0 for f in rows) / changes,
            "tokens_out": sum(f.get("tokens_out") or 0 for f in rows) / changes,
            "cache_read": cache_sum / cache_changes if cached else None,
            "cache_share": cache_sum / cache_in if cached and cache_in else None,
        }
    return out


PLANNER_STOPS = ("blocked", "rejected", "returned")
MAX_PLANNERS = 20


def planners(jobs, fires, now, window_s=7 * 86400):
    groups = {}
    for j in jobs:
        if not 0 <= now - j["first"] <= window_s:
            continue
        before = [f for f in fires if f["parent"] == j["parent"] and f["at"] <= j["first"]]
        name = max(before, key=lambda f: f["at"])["coworker"] if before and j["parent"] is not None else "-"
        groups.setdefault(name, []).append(j)
    out = []
    for name in sorted(groups):
        rows = groups[name]
        merged = [j for j in rows if j["state"] == "merged"]
        first = [j for j in merged if "fix_wait" not in j["states"] and not j["replans"]]
        out.append({"planner": name, "cut": len(rows), "merged": len(merged), "firstPass": len(first),
                    "firstPassYield": len(first) / len(merged) if merged else None,
                    "stopped": sum(1 for j in rows if any(s in PLANNER_STOPS for s in j["states"])),
                    "replans": sum(j["replans"] or 0 for j in rows)})
    return out[:MAX_PLANNERS]
