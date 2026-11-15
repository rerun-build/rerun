import states

ENDED = ("blocked", "failed", "rejected")
IDLE_BEATS = 10
REPEATS = 5
WINDOW_S = 3600


class Watch:
    def __init__(self):
        self.heard, self.idle, self.idle_line, self.repeats, self.repeat_line = [], 0, None, None, None

    def find(self, jobs, refused, open_issues, line, now, texts):
        out = {"unreadable #%d" % n: "\n".join(e) for n, e in refused.items()}
        work, busy = bool(refused), False
        for j in jobs:
            n, st = j["issue"], j["state"]
            if st == "waiting" and j.get("dead"):
                out["dead #%d" % n] = j.get("wait_line") or "waits on dead dependencies"
                work = True
            elif st in ENDED and open_issues is not None and n in open_issues:
                out["ended #%d" % n] = "job #%d ended %s: %s; pull request %s" % (
                    n, st, j.get("reason") or "-", "#%s" % j["pr"] if j.get("pr") else "none")
            work = work or st in states.QUEUE
            busy = busy or (st in states.RUNNING and bool(j.get("agent")))
        self.idle = self.idle + 1 if work and not busy else 0
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
