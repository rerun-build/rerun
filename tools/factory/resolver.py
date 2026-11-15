import json
import re

import holds
import pools
import problems
import snapshot
import states

KV = "problems"
LABEL = "factory-problem"
OWNER = "owner"
POOL = "resolver"
OPEN_EVERY = 10
NEW_MAX = 10
OPEN_MAX = 30
CLEAR_BEATS = 3
VERIFY_BEATS = 6
ATTEMPTS = 3
FORMS = ({"prefix": "RESOLVED: ", "rest": "sentence"}, {"prefix": "FILED: ", "rest": "sentence"}, {"prefix": "ESCALATE: ", "rest": "sentence"})
FINAL = re.compile(r"(?m)^(?:RESOLVED|FILED|ESCALATE):[ \t]*\S[^\n]*")
DO = re.compile(r"(?m)^DO: ([^\n]*)")
DO_MAX = 10


def safe(text):
    return str(text).replace("@", "").replace("`", "'")[:200]


def body(key, evidence):
    return "Problem-Key: %s\n\n%s\n\nOpened by the factory dispatcher; it closes this issue once the problem is gone for %d beats." % (
        key, evidence, CLEAR_BEATS)


def rank(key):
    return (key not in ("idle line", "repeating error"), key)


class Resolver:
    def __init__(self, log, brief):
        self.log, self.brief = log, brief
        self.watch = problems.Watch()
        self.open_issues, self.beats, self.found, self.capped = None, 0, {}, None

    def switches(self, d):
        s = d.cfg.get("resolver") or {}
        return bool(s.get("detect")), bool(s.get("detect") and s.get("resolve") and POOL in pools.types(d.cfg))

    def running(self, d):
        return [(r["agent"], r.get("copy")) for r in self.records(d).values() if r["state"] == "resolving" and r.get("agent")]

    def waiting(self, d):
        if not self.switches(d)[1]:
            return 0
        recs = list(self.records(d).values())
        copies = sum(c["runs"] for c in pools.types(d.cfg)[POOL]["coworkers"])
        free = copies - sum(1 for r in recs if r["state"] == "resolving")
        return max(0, min(free, sum(1 for r in recs if r["state"] == "resolve_wait")))

    def counts(self, d):
        recs = list(self.records(d).values())
        return len(recs), sum(1 for r in recs if r["state"] == "owner")

    def records(self, d):
        out = {}
        for k, v in d.store.get_all(KV).items():
            try:
                r = json.loads(v)
            except ValueError:
                continue
            if r.get("state") != "closed":
                out[k] = r
        return out

    def put(self, d, key, r):
        d.store.set(KV, key, json.dumps(r))

    def beat(self, d, heard, line):
        detect, resolve = self.switches(d)
        if not detect:
            return
        self.beats += 1
        jobs = d.jobs()
        if any(j["state"] in problems.ENDED for j in jobs) and (self.open_issues is None or self.beats % OPEN_EVERY == 0):
            self.open_issues = {i["number"] for i in json.loads(d.gh(
                ["issue", "list", "-R", d.repo, "--state", "open", "--json", "number", "--limit", "1000"]) or "[]")}
        self.found = self.watch.find(jobs, d.refused, self.open_issues, line, d.now(), heard)
        self.tickets(d, self.found)
        if resolve:
            self.station(d, self.found)

    def tickets(self, d, found):
        recs = self.records(d)
        for key, r in sorted(recs.items()):
            try:
                if key in found:
                    if found[key] != r["evidence"]:
                        d.gh(["issue", "edit", str(r["issue"]), "-R", d.repo, "--body", body(key, found[key])])
                    if found[key] != r["evidence"] or r.get("absent"):
                        r.update(evidence=found[key], absent=0)
                        self.put(d, key, r)
                elif r["state"] != "resolving":
                    r["absent"] = r.get("absent", 0) + 1
                    if r["absent"] >= CLEAR_BEATS:
                        text = "cleared at %s" % snapshot.iso(d.now()) + (": " + r["line"] if r["state"] == "verify" and r.get("line") else "")
                        d.gh(["issue", "close", str(r["issue"]), "-R", d.repo, "--comment", text])
                        r["state"] = "closed"
                        self.log(r["issue"], "problem closed: %s" % key)
                    self.put(d, key, r)
            except Exception as e:
                self.log(r["issue"], "problem %s: %s" % (key, e))
        new = sorted((k for k in found if k not in recs), key=rank)
        room = max(0, OPEN_MAX - len(self.records(d)))
        for key in new[:min(NEW_MAX, room)]:
            try:
                out = d.gh(["issue", "create", "-R", d.repo, "--title", "Factory problem: " + key, "--label", LABEL,
                            "--body", body(key, found[key])])
                n = int(re.search(r"/issues/(\d+)", out).group(1))
                self.put(d, key, {"issue": n, "evidence": found[key], "state": "resolve_wait", "absent": 0, "attempt": 1})
                self.log(n, "problem opened: %s" % key)
            except Exception as e:
                self.log("-", "problem %s not opened: %s" % (key, e))
        left = len(new) - min(len(new), room)
        text = "problems capped: %d not opened, %d open" % (left, OPEN_MAX) if left else None
        if text and text != self.capped:
            self.log("problems", text)
        self.capped = text

    def station(self, d, found):
        recs = self.records(d)
        if any(r["state"] == "owner" for r in recs.values()):
            self.owner_check(d, recs)
        for key, r in sorted(self.records(d).items()):
            try:
                if r["state"] == "resolving":
                    self.finished(d, key, r)
                elif r["state"] == "verify" and key in found:
                    self.verify(d, key, r)
            except Exception as e:
                self.log(r["issue"], "problem %s: %s" % (key, e))
        if holds.active(d.store, d.now()) is not None:
            return
        for key, r in sorted(self.records(d).items(), key=lambda kr: rank(kr[0])):
            if r["state"] != "resolve_wait":
                continue
            got = pools.pick_copy(d.cfg, POOL, d.running())
            if not got or not d.take({"state": "resolve_wait"}):
                return
            self.send(d, key, r, got)

    def send(self, d, key, r, got):
        agent, copy = got
        name = d.names.get(agent, agent[:8])
        args = {"agentId": agent, "message": self.brief(d.repo, key, r), "waitSeconds": 1,
                "goal": {"lastLineForms": [dict(f) for f in FORMS], "turnLimit": 3}}
        try:
            run = d.account("send_message", args)
        except Exception as e:
            self.log(r["issue"], "problem %s: send to %s raised: %s" % (key, name, e))
            return
        r.update(state="resolving", agent=agent, copy=copy, run=run["runId"], sent_at=d.now())
        self.put(d, key, r)
        self.log(r["issue"], "problem %s -> %s (run %s)" % (key, name, run["runId"]))

    def finished(self, d, key, r):
        run = d.account("get_run", {"agentId": r["agent"], "runId": r["run"]})
        if run.get("status") == "running":
            limit = int((d.cfg.get("clocks") or {}).get("run_limit_s", 2700))
            if d.now() - r["sent_at"] <= limit:
                return
            d.account("cancel_run", {"agentId": r["agent"], "runId": r["run"]})
            self.log(r["issue"], "problem %s: run %s past %d s, cancelled" % (key, r["run"], limit))
            run = {"status": "cancelled"}
        out = str(run.get("output") or "") if run.get("status") == "done" else ""
        lines = FINAL.findall(out)
        last = lines[-1].strip()[:500] if lines else None
        rid = r["run"]
        r.update(state="resolve_wait", agent=None, copy=None, run=None)
        if last and not last.startswith("ESCALATE:"):
            filed = re.match(r"FILED:\s*#(\d+)", last)
            r.update(state="verify", verify=0, line=last, filed=int(filed.group(1)) if filed else None)
        elif last or r.get("asked"):
            r["state"] = "owner"
        else:
            r["asked"] = 1
        self.put(d, key, r)
        self.log(r["issue"], "problem %s: run %s ended %s: %s" % (key, rid, run.get("status"), last or "no final line"))
        try:
            self.do_lines(d, r, rid, out)
        except Exception as e:
            self.log(r["issue"], "problem %s: DO lines of run %s: %s" % (key, rid, e))
        if r["state"] == "owner":
            self.escalate(d, r, last or "ESCALATE: HOUSE ended twice without a final line (last run %s)" % rid)

    def do_lines(self, d, r, rid, out):
        lines = [x.strip() for x in DO.findall(out)]
        if not lines:
            return
        done = ["- " + self.do(d, x) for x in lines[:DO_MAX]]
        if len(lines) > DO_MAX:
            done.append("- %d more DO lines not run: at most %d a run" % (len(lines) - DO_MAX, DO_MAX))
        d.gh(["issue", "comment", str(r["issue"]), "-R", d.repo, "--body", "The dispatcher ran the DO lines of run %s:\n%s" % (rid, "\n".join(done))])

    def do(self, d, text):
        verb, _, arg = text.partition(" ")
        arg = arg.strip()
        num = re.fullmatch(r"#(\d+)", arg)
        n = int(num.group(1)) if num else None
        j = d.store.get_job(str(n)) if n is not None else None
        try:
            if verb == "clear-hold" and arg in holds.KINDS:
                holds.clear(d.store, arg)
                return "DO: %s -> hold %s cleared" % (text, arg)
            if verb == "requeue" and j and j["state"] in problems.ENDED:
                d.gh(["issue", "edit", str(n), "-R", d.repo, "--add-label", d.label, "--remove-label", "factory-blocked"])
                return "DO: %s -> #%d labelled %s again; intake takes it on the next beat" % (text, n, d.label)
            if verb == "wait-off" and j and j.get("wait_reason"):
                j.pop("wait_reason")
                d.save(j, "wait reason dropped by a resolver run")
                return "DO: %s -> wait reason of #%d dropped" % (text, n)
            if verb == "rerun-ci" and n is not None and any(x.get("pr") == n for x in d.jobs()):
                return "DO: %s -> %s" % (text, self.rerun_ci(d, n))
        except Exception as e:
            return "DO: %s -> failed: %s" % (safe(text), safe(e))
        return "not allowed: DO: " + safe(text)

    def rerun_ci(self, d, pr):
        head = json.loads(d.gh(["pr", "view", str(pr), "-R", d.repo, "--json", "headRefOid"]))["headRefOid"]
        runs = json.loads(d.gh(["api", "repos/%s/actions/runs?head_sha=%s&per_page=100" % (d.repo, head)])).get("workflow_runs") or []
        latest = {}
        for run in runs:
            w = run.get("workflow_id")
            if w not in latest or run["id"] > latest[w]["id"]:
                latest[w] = run
        failed = sorted(run["id"] for run in latest.values() if run.get("conclusion") in ("failure", "timed_out"))
        for rid in failed:
            d.gh(["run", "rerun", str(rid), "-R", d.repo, "--failed"])
        if not failed:
            return "no failed run at %s" % head[:7]
        return "re-ran the failed jobs of run %s at %s" % (", ".join(str(x) for x in failed), head[:7])

    def verify(self, d, key, r):
        j = d.store.get_job(str(r["filed"])) if r.get("filed") else None
        if not (j and j["state"] not in states.END):
            r["verify"] = r.get("verify", 0) + 1
        if r["verify"] >= VERIFY_BEATS:
            r["attempt"] = r.get("attempt", 1) + 1
            if r["attempt"] >= ATTEMPTS:
                self.escalate(d, r, "ESCALATE: the problem is still there after %d attempts; the last one ended with: %s" % (ATTEMPTS - 1, r.get("line")))
                r["state"] = "owner"
            else:
                r.update(state="resolve_wait", verify=0, asked=0)
        self.put(d, key, r)

    def escalate(self, d, r, line):
        d.gh(["issue", "edit", str(r["issue"]), "-R", d.repo, "--add-label", OWNER])
        d.gh(["issue", "comment", str(r["issue"]), "-R", d.repo, "--body", line])

    def owner_check(self, d, recs):
        listed = json.loads(d.gh(["issue", "list", "-R", d.repo, "--label", LABEL, "--state", "open",
                                  "--json", "number,labels", "--limit", "100"]) or "[]")
        labels = {i["number"]: {x.get("name") for x in i.get("labels") or []} for i in listed}
        for key, r in recs.items():
            if r["state"] == "owner" and r["issue"] in labels and OWNER not in labels[r["issue"]]:
                r.update(state="resolve_wait", attempt=1, asked=0, verify=0)
                self.put(d, key, r)
                self.log(r["issue"], "problem %s: the owner label was removed, sent again" % key)
