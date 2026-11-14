def review_event(pr):
    return "review-ready:%s" % pr


def claim_wake(store, event, coworker, head):
    return store.add_wake(event, coworker, head)


ENDED_BAD = ("failed", "cancelled", "missing")


def end_wake(store, event, coworker, head, status):
    return store.release_wake(event, coworker, head) if status in ENDED_BAD else False
