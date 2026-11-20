import cutshape
import states

ENDED = ("blocked", "failed", "rejected")
IDLE_BEATS = 10
REPEATS = 5
WINDOW_S = 3600


def ended(j, since):
    return j["state"] in ENDED and str(j.get("ended_at") or "") >= since


class Watch:
    def __init__(self):
        self.heard, self.idle, self.idle_line, self.repeats, self.repeat_line = [], 0, None, None, None

    def find(self, jobs, refused, open_issues, line, now, texts, since="", held=False, room=None):
        out = {"unreadable #%d" % n: "\n".join(e) for n, e in refused.items()}
        if room:
            out["no room"] = room
        work, busy = False, False
        dev = [j for j in jobs if j.get("dev_result") in ("green", "red") and j.get("dev_since") is not None]
        latest = max(dev, key=lambda j: j["dev_since"], default=None)
        if latest and latest["dev_result"] == "red":
            out["dev red"] = (
                "dev is red at %s after the merge of pull request #%s (job #%d): %s\n"
                "The resolver re-runs the failed run (`gh run rerun <id> --failed`) when the failure is not from this change, "
                "or files the fix as a factory issue and ends with FILED: #<n>. Only that issue is merged while dev is red."
            ) % ((latest.get("merge_sha") or "-")[:7], latest.get("pr") or "-", latest["issue"], latest.get("dev_why") or "-")
        parents = {cutshape.parse({"number": j["issue"], "body": j.get("body") or ""})["parent"] for j in jobs}
        for j in jobs:
            n, st = j["issue"], j["state"]
            if j.get("checkout_failed") and (st not in states.END or (
                    str(j.get("ended_at") or "") >= since and open_issues is not None and n in open_issues)):
                out["checkout failed #%d" % n] = j["checkout_failed"]
            if st == "waiting" and any(d[1] not in states.PROBLEM for d in j.get("dead") or []):
                out["dead #%d" % n] = j.get("wait_line") or "waits on dead dependencies"
            elif ended(j, since) and open_issues is not None and n in open_issues and n not in parents:
                out["ended #%d" % n] = "job #%d ended %s: %s; pull request %s" % (
                    n, st, j.get("reason") or "-", "#%s" % j["pr"] if j.get("pr") else "none")
            work = work or st in states.QUEUE
            busy = busy or (st in states.RUNNING and bool(j.get("agent")))
        self.idle = self.idle + 1 if work and not busy and not held else 0
        if self.idle < IDLE_BEATS:
            self.idle_line = None
        elif self.idle_line is None:
            self.idle_line = "no run in flight for %d beats while work waits; beat line: %s" % (IDLE_BEATS, line)
        if self.idle_line:
            out["idle line"] = self.idle_line
        self.heard = [(t, x) for t, x in self.heard if now - t < WINDOW_S] + [(now, x) for x in texts]
        count = {}
        for _, x in self.heard:
            count[x] = count.get(x, 0) + 1
        repeats = sorted(x for x, c in count.items() if c >= REPEATS)
        if repeats != self.repeats:
            self.repeats = repeats
            self.repeat_line = "\n".join("%s (%d times in the last hour)" % (x, count[x]) for x in repeats)
        if repeats:
            out["repeating error"] = self.repeat_line
        return out
