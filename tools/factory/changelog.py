N = 20


def rate(events, jobs, group):
    if not jobs:
        return None
    ids = set(jobs)
    hit = sum(1 for e in events if e["group"] == group and e["job"] in ids)
    return hit * N / len(jobs)


def before(ended, at, n=N):
    done = sorted((j for j in ended if j["ended"] <= at), key=lambda j: j["ended"])
    return [j["job"] for j in done[-n:]] if n > 0 else []


def after(ended, live_at, now, n=N):
    done = sorted((j for j in ended if j["started"] >= live_at and j["ended"] <= now), key=lambda j: j["ended"])
    if len(done) < n:
        return None
    return [j["job"] for j in done[:n]]


def verdict(rate_before, rate_after):
    if rate_before is None or rate_after is None:
        return "revert"
    return "kept" if rate_after < rate_before else "revert"
