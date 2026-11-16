import states

REASONS = ("dependency", "no free worker of its type", "back-off", "hold", "plan limit", "sign-in renewal")

_QUEUE_STATES = states.QUEUE


def reason(job, now, hold=None, held=()):
    state = job.get("state")
    if state == "waiting":
        return "dependency"
    if state == "checks":
        return job.get("checks_why")
    if state not in _QUEUE_STATES:
        return None
    not_before = job.get("not_before")
    if not_before is not None and not_before > now:
        return "back-off"
    if hold:
        kind = hold.get("kind")
        return kind if kind in ("plan limit", "sign-in renewal") else "hold"
    if held:
        return "coworker held: " + ", ".join(held)
    return "no free worker of its type"
