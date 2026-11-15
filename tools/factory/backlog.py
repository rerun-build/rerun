import calendar, json, time

JOB = "_backlog"
LABEL = "likely-fixed"
DAY = 86400
MAX_PER_PASS = 20


def stamp(s):
    return calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))


def evidence(events, now, days):
    label = None
    for e in events:
        if (e.get("label") or {}).get("name") != LABEL:
            continue
        if e.get("event") == "labeled":
            label = e
        elif e.get("event") == "unlabeled":
            label = None
    if label is None:
        return None
    at = stamp(label["created_at"])
    if now - at < days * DAY:
        return None
    url = None
    for e in events:
        if e.get("event") == "commented" and stamp(e["created_at"]) <= at and e.get("html_url"):
            url = e["html_url"]
    return url


def close_pass(gh, repo, store, now, days=7):
    last = store.get_all(JOB).get("last_pass")
    if last is not None and now - float(last) < DAY:
        return []
    store.set(JOB, "last_pass", now)
    listed = json.loads(gh(["issue", "list", "-R", repo, "--label", LABEL, "--state", "open",
                            "--json", "number", "--limit", "100"]) or "[]")
    numbers = sorted(i["number"] for i in listed)[:MAX_PER_PASS]
    closed = []
    for n in numbers:
        events = json.loads(gh(["api", "repos/%s/issues/%d/timeline?per_page=100" % (repo, n)]) or "[]")
        url = evidence(events, now, days)
        if not url:
            continue
        text = "Closing: labelled %s for %d days or more with no change. Evidence: %s" % (LABEL, days, url)
        gh(["issue", "close", str(n), "-R", repo, "--comment", text])
        closed.append(n)
    return closed
