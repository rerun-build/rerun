import json
import re

import clocks
import holds
import inboxsort
import pools
import problems
import snapshot
import states
import store as ledger_store
import tiers

KV = "problems"
LABEL = "factory-problem"
OWNER = "owner"
POOL = "resolver"
KINDS = ("dev red", "idle line", "repeating error", "dead", "unreadable", "ended", "checkout failed", "no room")
SYSTEMIC = KINDS[1:3]
NOTICE = (inboxsort.ALARM,)
NEW_MAX = 10
OPEN_MAX = 30
CLEAR_BEATS = 3
SYSTEMIC_CLEAR_BEATS = 120
START_BEATS = 10
SEND_MAX = 6
ADMIN = "special-place-administrator"
VERIFY_BEATS = 6
ATTEMPTS = 3
TRANSIENT_MAX = 3
REQUEUE_MAX = 3
FORMS = ({"prefix": "RESOLVED: ", "rest": "sentence"}, {"prefix": "FILED: ", "rest": "sentence"}, {"prefix": "ESCALATE: ", "rest": "sentence"})
FINAL = re.compile(r"(?m)^(?:RESOLVED|FILED|ESCALATE):[ \t]*\S[^\n]*")
DO = re.compile(r"(?m)^DO: ([^\n]*)")
DO_MAX = 4
FENCE = re.compile(r"(?ms)^```.*?(?:^```[^\n]*$|\Z)")
GONE = re.compile(r"Could not resolve to an issue|HTTP 40[4]\b|HTTP 410\b")
UNLABELED = ("query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n)"
             "{timelineItems(last:20,itemTypes:[UNLABELED_EVENT]){nodes{... on UnlabeledEvent{label{name} actor{login}}}}}}}")
KEY_LINE = re.compile(r"(?m)^Problem-Key: (.+?)\s*$")


def safe(text):
    return str(text).replace("@", "").replace("`", "'")[:200]


def fenced(text):
    return "```\n%s\n```" % str(text).replace("```", "'''")


def body(key, evidence):
    return "%s\n\nOpened by the factory dispatcher; it closes this issue once the problem is gone for %d beats." % (
        fenced("Problem-Key: %s\n\n%s" % (key, evidence)), SYSTEMIC_CLEAR_BEATS if key in SYSTEMIC else CLEAR_BEATS)


def rank(key):
    return (next((i for i, k in enumerate(KINDS) if key.startswith(k)), len(KINDS)), key)


class Resolver:
    def __init__(self, log, brief):
        self.log, self.brief = log, brief
        self.watch = problems.Watch()
        self.open_issues, self.found, self.capped, self.beats = None, {}, None, 0

    def switches(self, d):
        s = d.cfg.get("resolver") or {}
        return bool(s.get("detect")), bool(s.get("detect") and s.get("resolve") and POOL in pools.types(d.cfg))

    def records(self, d, closed=False):
        out = {}
        for k, v in d.store.get_all(KV).items():
            try:
                r = json.loads(v)
            except ValueError:
                continue
            if closed or r.get("state") != "closed":
                out[k] = r
        return out

    def put(self, d, key, r):
        d.store.set(KV, key, json.dumps(r))

    def running(self, d):
        if not self.switches(d)[1]:
            return []
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

    def beat(self, d, heard, line):
        detect, resolve = self.switches(d)
        if not detect:
            return
        self.beats += 1
        since = d.store.get_all("-").get("problems_since")
        if not since:
            since = ledger_store.now()
            d.store.set("-", "problems_since", since)
        jobs = d.jobs()
        filed = any(r["state"] == "verify" and r.get("filed") for r in self.records(d).values())
        if filed or any(problems.ended(j, since) or (j.get("checkout_failed") and j["state"] in states.END) for j in jobs):
            self.open_issues = {i["number"] for i in json.loads(d.gh(
                ["issue", "list", "-R", d.repo, "--state", "open", "--json", "number", "--limit", "1000"]) or "[]")}
        held = holds.active(d.store, d.now()) is not None
        self.found = self.watch.find(jobs, d.refused, self.open_issues, line, d.now(), heard, since, held, d.no_room())
        self.found.update(inboxsort.alarm(d.store.get_all("-")))
        self.tickets(d, self.found, resolve)
        if resolve:
            self.station(d, self.found)

    def forget(self, d, key, r, e):
        if not GONE.search(str(e)):
            raise e
        self.log(r.get("issue") or "-", "problem %s: its issue is gone, forgotten: %s" % (key, e))
        r.update(state="closed", issue=None)
        self.put(d, key, r)

    def tickets(self, d, found, resolve):
        for key, r in sorted(self.records(d).items()):
            try:
                self.ticket(d, key, r, found, resolve)
            except Exception as e:
                self.forget(d, key, r, e)
        recs = self.records(d)
        new = sorted((k for k in found if k not in recs), key=rank)
        room = max(0, OPEN_MAX - len(recs))
        old, listed = self.records(d, closed=True), None
        for key in new[:min(NEW_MAX, room)]:
            fresh = {"evidence": found[key], "state": "notice" if key in NOTICE else "resolve_wait", "absent": 0, "attempt": 1, "asked": 0, "verify": 0,
                     "agent": None, "copy": None, "run": None, "transient": 0, "line": None, "filed": None}
            if old.get(key, {}).get("issue"):
                n = old[key]["issue"]
                try:
                    d.gh(["issue", "reopen", str(n), "-R", d.repo])
                    d.gh(["issue", "edit", str(n), "-R", d.repo, "--body", body(key, found[key])])
                except Exception as e:
                    self.forget(d, key, old[key], e)
                    continue
                self.put(d, key, dict(old[key], **fresh))
                self.log(n, "problem reopened: %s" % key)
                continue
            if listed is None:
                listed = self.listed(d)
            if key in listed:
                self.put(d, key, dict(old.get(key, {}), **dict(fresh, issue=listed[key], evidence="")))
                self.log(listed[key], "problem adopted: %s" % key)
                continue
            out = d.gh(["issue", "create", "-R", d.repo, "--title", "Factory problem: " + key, "--label", LABEL,
                        "--body", body(key, found[key])])
            n = int(re.search(r"/issues/(\d+)", out).group(1))
            self.put(d, key, dict(old.get(key, {}), **dict(fresh, issue=n)))
            self.log(n, "problem opened: %s" % key)
        left = len(new) - min(len(new), room)
        text = "problems capped: %d not opened, %d open" % (left, OPEN_MAX) if left else None
        if text and text != self.capped:
            self.log("problems", text)
        self.capped = text

    def ticket(self, d, key, r, found, resolve):
        if key in found:
            if found[key] != r["evidence"]:
                d.gh(["issue", "edit", str(r["issue"]), "-R", d.repo, "--body", body(key, found[key])])
            if found[key] != r["evidence"] or r.get("absent"):
                r.update(evidence=found[key], absent=0)
                self.put(d, key, r)
        elif not (resolve and r["state"] == "resolving") and not (key in SYSTEMIC and self.beats <= START_BEATS):
            r["absent"] = r.get("absent", 0) + 1
            if r["absent"] >= (SYSTEMIC_CLEAR_BEATS if key in SYSTEMIC else CLEAR_BEATS):
                line = r.get("line") if r["state"] == "verify" else None
                text = "cleared at %s" % snapshot.iso(d.now()) + (": " + line.replace("@", "") if line else "")
                d.gh(["issue", "close", str(r["issue"]), "-R", d.repo, "--comment", text])
                r["state"] = "closed"
                self.log(r["issue"], "problem closed: %s" % key)
            self.put(d, key, r)

    def listed(self, d):
        found = json.loads(d.gh(["issue", "list", "-R", d.repo, "--label", LABEL, "--state", "open",
                                 "--json", "number,body", "--limit", "100"]) or "[]")
        out = {}
        for i in found:
            for k in KEY_LINE.findall(i.get("body") or ""):
                out.setdefault(k, i["number"])
        return out

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
            if r["state"] != "resolve_wait" or key not in found:
                continue
            if r.get("sends", 0) >= SEND_MAX:
                self.escalate(d, r, "ESCALATE: sent to HOUSE %d times and still there; the last run ended with: %s" % (SEND_MAX, r.get("line") or "-"))
                r["state"] = "owner"
                self.put(d, key, r)
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
        r.update(state="resolving", agent=agent, copy=copy, run=None, sent_at=d.now(), sends=r.get("sends", 0) + 1)
        r["fire"] = d.store.intent(str(r["issue"]), "", "resolve", coworker=name)
        self.put(d, key, r)
        try:
            try:
                model = tiers.model_for("resolve", tiers.tier_for("resolve", "medium", d.cfg.get("tiers")), d.cfg.get("tier_models"))
            except ValueError:
                model = None
            if model:
                args.update(model)
            run = d.account("send_message", args)
        except Exception as e:
            d.store.abandon(r["fire"], str(e)[:200])
            self.log(r["issue"], "problem %s: send to %s raised, its copy stays taken until the run limit: %s" % (key, name, e))
            return
        r["run"] = (run or {}).get("runId")
        d.store.fired(r["fire"], r["run"])
        self.put(d, key, r)
        self.log(r["issue"], "problem %s -> %s (run %s)" % (key, name, r["run"]))

    def close_fire(self, d, r, run):
        counts = [run.get(k) for k in ("inputTokens", "outputTokens", "cachedInputTokens")]
        good = lambda x: isinstance(x, int) and not isinstance(x, bool) and x >= 0
        ti, to, cr = counts[0] if good(counts[0]) else 0, counts[1] if good(counts[1]) else 0, counts[2] if good(counts[2]) else None
        d.store.close_run(r["run"], "done" if run.get("status") == "done" else "error", tokens_in=ti, tokens_out=to, cache_read=cr)

    def back(self, d, key, r, why):
        r.update(state="resolve_wait", agent=None, copy=None, run=None)
        self.put(d, key, r)
        self.log(r["issue"], "problem %s: %s" % (key, why))

    def finished(self, d, key, r):
        limit = int((d.cfg.get("clocks") or {}).get("run_limit_s", 2700))
        late = d.now() - r["sent_at"] > limit
        if r["run"] is None:
            return self.back(d, key, r, "no run id after the run limit, sent again") if late else None
        try:
            run = d.account("get_run", {"agentId": r["agent"], "runId": r["run"]})
        except Exception:
            if not late:
                raise
            run = {"status": "lost"}
        if run.get("status") == "running":
            if not late:
                return
            d.account("cancel_run", {"agentId": r["agent"], "runId": r["run"]})
            self.log(r["issue"], "problem %s: run %s past %d s, cancelled" % (key, r["run"], limit))
            run = {"status": "cancelled"}
        self.close_fire(d, r, run)
        if run.get("status") == "error":
            k = clocks.klass("ERROR", run)
            if k == "plan_limit":
                holds.arm(d.store, "plan limit", d.now() + holds.PLAN_LIMIT_HOLD_S)
                return self.back(d, key, r, "plan limit; all sending held for %d s" % holds.PLAN_LIMIT_HOLD_S)
            if k == "transient" and r.get("transient", 0) < TRANSIENT_MAX:
                r["transient"] = r.get("transient", 0) + 1
                return self.back(d, key, r, "transient error %d of %d, sent again" % (r["transient"], TRANSIENT_MAX))
        out = str(run.get("output") or "") if run.get("status") == "done" else ""
        lines = FINAL.findall(out)
        last = lines[-1].strip()[:500] if lines else None
        rid = r["run"]
        r.update(state="resolve_wait", agent=None, copy=None, run=None)
        if last and not last.startswith("ESCALATE:"):
            filed = re.match(r"FILED:\s*#(\d+)", last)
            r.update(state="verify", verify=0, line=last, filed=int(filed.group(1)) if filed else None)
            self.handled(d, key)
        elif last or r.get("asked"):
            self.escalate(d, r, last or "ESCALATE: HOUSE ended twice without a final line (last run %s)" % rid)
            r["state"] = "owner"
        else:
            r["asked"] = 1
        self.put(d, key, r)
        self.log(r["issue"], "problem %s: run %s ended %s: %s" % (key, rid, run.get("status"), last or "no final line"))
        try:
            self.do_lines(d, r, rid, out)
        except Exception as e:
            self.log(r["issue"], "problem %s: DO lines of run %s: %s" % (key, rid, e))

    def handled(self, d, key):
        m = re.fullmatch(r"checkout failed #(\d+)", key)
        j = d.store.get_job(m.group(1)) if m else None
        if j and j.pop("checkout_failed", None):
            d.save(j, "checkout failure handed to a resolver run")

    def do_lines(self, d, r, rid, out):
        lines = list(dict.fromkeys(x.strip() for x in DO.findall(FENCE.sub("", out))))
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
                takes = j.get("takes") or j.get("take") or 1
                if takes >= REQUEUE_MAX:
                    return "not allowed: DO: %s (taken %d times; Rob decides)" % (text, takes)
                d.gh(["issue", "edit", str(n), "-R", d.repo, "--add-label", d.label, "--remove-label", "factory-blocked"])
                return "DO: %s -> #%d labelled %s again; intake takes it on the next beat" % (text, n, d.label)
            if verb == "wait-off" and j and j["state"] in states.WAIT_STATES and (j.get("not_before") or j.get("wait_reason")):
                j.pop("not_before", None)
                j.pop("wait_reason", None)
                d.save(j, "back-off and wait reason dropped by a resolver run")
                return "DO: %s -> back-off and wait reason of #%d dropped" % (text, n)
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
        live = bool(j and j["state"] not in states.END) or (r.get("filed") is not None and r["filed"] in (self.open_issues or ()))
        if not live:
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
        d.gh(["issue", "comment", str(r["issue"]), "-R", d.repo, "--body", fenced(line)])

    def owner_check(self, d, recs):
        listed = json.loads(d.gh(["issue", "list", "-R", d.repo, "--label", LABEL, "--state", "open",
                                  "--json", "number,labels", "--limit", "100"]) or "[]")
        labels = {i["number"]: {x.get("name") for x in i.get("labels") or []} for i in listed}
        for key, r in recs.items():
            if r["state"] != "owner" or r["issue"] not in labels or OWNER in labels[r["issue"]]:
                continue
            owner, name = d.repo.split("/", 1)
            events = json.loads(d.gh(["api", "graphql", "-f", "query=" + UNLABELED, "-f", "owner=" + owner, "-f", "name=" + name,
                                      "-F", "n=%d" % r["issue"], "--jq", ".data.repository.issue.timelineItems.nodes"]) or "[]")
            off = [e for e in events or [] if (e.get("label") or {}).get("name") == OWNER]
            who = (off[-1].get("actor") or {}).get("login") if off else None
            if who != ADMIN:
                d.gh(["issue", "edit", str(r["issue"]), "-R", d.repo, "--add-label", OWNER])
                self.log(r["issue"], "problem %s: the owner label was removed by %s, put back" % (key, who or "unknown"))
                continue
            r.update(state="resolve_wait", attempt=1, asked=0, verify=0)
            self.put(d, key, r)
            self.log(r["issue"], "problem %s: Rob removed the owner label, sent again" % key)
