QUEUED = ("queued", "waiting", "requested", "pending")


def unfinished(runs):
    return [r for r in runs if r.get("status") != "completed"]


def pending_text(runs):
    queued = [r["name"] for r in runs if r.get("status") in QUEUED]
    running = [r["name"] for r in runs if r.get("status") not in QUEUED]
    parts = []
    if queued:
        parts.append("queued: " + ", ".join(queued))
    if running:
        parts.append("running: " + ", ".join(running))
    return "; ".join(parts)


def cancelled_ids(runs):
    passed = {r.get("workflow_id") for r in runs if r.get("conclusion") == "success"}
    return [r["id"] for r in runs
            if r.get("status") == "completed" and r.get("conclusion") == "cancelled"
            and r.get("workflow_id") not in passed and r.get("id") is not None]
