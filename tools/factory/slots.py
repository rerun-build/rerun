WAITING = {"review_wait": "review", "fix_wait": "fix", "proof_wait": "proof", "resolve_wait": "resolve"}


def station(job):
    if job.get("state") == "queued":
        return job.get("worker") or "coder"
    return WAITING.get(job.get("state"))


def quotas(waiting, in_use, total):
    out = {s: 0 for s in waiting}
    free = max(0, total - in_use)
    first = sorted((s for s, n in waiting.items() if n > 0), key=lambda s: (-waiting[s], s))
    for s in first:
        if not free:
            return out
        out[s] = 1
        free -= 1
    while free:
        open_ = [s for s in waiting if out[s] < waiting[s]]
        if not open_:
            break
        best = min(open_, key=lambda s: (-waiting[s] / (out[s] + 1), s))
        out[best] += 1
        free -= 1
    return out
