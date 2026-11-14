import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import limits as L


def queue_measures(ready, fires, now, cfg=None):
    end = L.ts(now)
    builds = [f for f in fires if f["stage"] == "build"]
    start = {}
    for f in builds:
        k, t = (f["job"], f["chunk"]), L.ts(f["intent_at"])
        start[k] = min(t, start.get(k, t))
    spans = [(L.ts(r["added_at"]), start.get((r["job"], r["chunk"]), end)) for r in ready]
    busy = [(L.ts(f["intent_at"]), L.ts(f["ended_at"]) if f.get("ended_at") else end) for f in builds]
    edges = sorted({t for s in spans + busy for t in s})
    stalled = 0.0
    for a, b in zip(edges, edges[1:]):
        waiting = any(s <= a and b <= e for s, e in spans)
        if waiting and sum(1 for s, e in busy if s <= a and b <= e) < L.capacity(cfg):
            stalled += b - a
    return {"depth": sum(1 for r in ready if (r["job"], r["chunk"]) not in start),
            "wait_s": [e - s for s, e in spans], "stalled_s": stalled}


def occupancy_measures(fires, wakes, commits, green, now, cfg=None):
    end, builds = L.ts(now), [f for f in fires if f["stage"] == "build"]
    spans = [(L.ts(f["intent_at"]), L.ts(f["ended_at"]) if f.get("ended_at") else end) for f in builds]
    window = (end - min(s for s, _ in spans)) * L.capacity(cfg) if spans else 0
    quiet = sum(1 for w in wakes if not any(f["coworker"] == w["coworker"] and L.ts(f["intent_at"]) >= L.ts(w["at"]) for f in fires))
    done = set(map(tuple, commits))
    return {"occupancy": sum(e - s for s, e in spans) / window if window else None,
            "quiet_wake_rate": quiet / len(wakes) if wakes else None,
            "no_commit": sum(1 for f in builds if f.get("ended_at") and (f["job"], f["chunk"]) not in done),
            "early_reviews": sum(1 for f in fires if f["stage"] == "review"
                                 and (f["job"] not in green or L.ts(f["intent_at"]) < L.ts(green[f["job"]])))}


TOKEN_FIELDS = (("fresh_input", "tokens_in"), ("output", "tokens_out"), ("cache_write", "cache_write"), ("cache_read", "cache_read"))


def token_split(fires, merged):
    keep = set(map(tuple, merged))
    rows = [f for f in fires if (f["job"], f["chunk"]) in keep]
    out = {"changes": len(keep)}
    for name, col in TOKEN_FIELDS:
        vals = [f[col] for f in rows if f.get(col) is not None]
        out[name] = sum(vals) / len(keep) if vals and keep else None
    return out


def review_measures(fires, now):
    end, out = L.ts(now), {}
    for job in sorted({f["job"] for f in fires}):
        rows = [f for f in fires if f["job"] == job]
        rev = [f for f in rows if f["stage"] == "review"]
        spans = [(L.ts(f["intent_at"]), L.ts(f["ended_at"]) if f.get("ended_at") else end) for f in rows if f["stage"] == "build"]
        out[job] = {"review_runs": len(rev), "review_tokens": sum((f.get("tokens_in") or 0) + (f.get("tokens_out") or 0) for f in rev),
                    "coworkers": len({f["coworker"] for f in rows if f.get("coworker")}),
                    "peak_chunks": max((sum(1 for s, e in spans if s <= a < e) for a, _ in spans), default=0)}
    return out
