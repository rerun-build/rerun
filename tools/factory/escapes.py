import datetime, json, re
import limits

WINDOW_S = 7 * 24 * 3600
EVERY = 10
ESCAPED = "escaped"
REPAIRS = re.compile(r"^\*\*Repairs\*\*: (.*)$", re.M)
DEV_RED = "dev red"


def repairs(body):
    found = set()
    for line in REPAIRS.findall(body or ""):
        named = line.split("(")[0]
        if named.strip().lower().startswith("none"):
            continue
        found.update(int(n) for n in re.findall(r"#(\d+)", named))
    return sorted(found)


def job_of_key(key, evidence):
    if key == DEV_RED:
        m = re.search(r"\(job #(\d+)\)", (evidence or "").split("\n")[0])
    else:
        m = re.search(r"#(\d+)", key)
    return int(m.group(1)) if m else None


def in_window(j, now):
    return j.get("state") == "merged" and j.get("merged_at") is not None and 0 <= now - j["merged_at"] <= WINDOW_S


def find(jobs, open_numbers, problems, now):
    out = set()
    for j in jobs:
        if not in_window(j, now):
            continue
        n = int(j["issue"])
        if open_numbers is not None and n in open_numbers:
            out.add((n, "reopened"))
        for other in jobs:
            if int(other["issue"]) != n and n in repairs(other.get("body")):
                out.add((n, "repair #%d" % int(other["issue"])))
        for key, r in (problems or {}).items():
            if job_of_key(key, (r or {}).get("evidence")) == n:
                out.add((n, "problem %s" % key))
    return sorted(out)


def merged_at(store, j):
    times = [t["at"] for t in store.transitions_of(str(j["issue"])) if t["to_state"] == "merged" and t["from_state"] != "merged"]
    return limits.ts(times[-1]) if times else None


def record(store, job, by, now):
    key = "%s|%s" % (job, by)
    if key in store.get_all(ESCAPED):
        return False
    at = datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    store.set(ESCAPED, key, json.dumps({"job": str(job), "by": by, "at": at}))
    store.add_failure(ESCAPED, job, reason=by)
    return True
