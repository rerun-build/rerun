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
