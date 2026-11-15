def per_merged(fires, merged, key):
    keep = set(map(tuple, merged))
    groups = {}
    for f in fires:
        if (f["job"], f["chunk"]) in keep:
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
