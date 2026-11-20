import hashlib
import json
import re

import authors
import pools

FORMS = ({"prefix": "VERDICT: ", "rest": "sentence"},)

FENCE = "~~~~"
EVERY = 10
RUN_LIMIT = 2700


def _line(text, key):
    m = re.search(r"^\*\*%s\*\*:[ \t]*(.*)$" % key, text, re.M)
    return m.group(1).strip() if m else None


def fence(*texts):
    lines = [l for t in texts for l in re.findall(r"^~{4,}[ \t]*$", t or "", re.M)]
    if not lines:
        return FENCE
    return "~" * (max(len(l.strip()) for l in lines) + 1)


def _block(text, key):
    m = re.search(r"^\*\*%s\*\*[ \t]*\n(~{4,})[ \t]*\n(.*?)\n?^\1[ \t]*$" % key, text, re.M | re.S)
    return m.group(2) if m else None


def parse(issue):
    if isinstance(issue, dict):
        number, text = issue.get("number"), issue.get("body") or ""
    else:
        number, text = None, issue or ""
    text = text.replace("\r\n", "\n")
    errors = []
    out = {"number": number}
    for key, name in (("Coworker", "coworker"), ("Cause", "cause"), ("Reason", "reason")):
        value = _line(text, key)
        if not value:
            errors.append("the line **%s**: is missing" % key)
        out[name] = value or ""
    old = _block(text, "Old text")
    new = _block(text, "New text")
    if old is None:
        errors.append("the **Old text** block is missing")
    if new is None:
        errors.append("the **New text** block is missing")
    elif not new.strip() and not (old and out["reason"].startswith("Reverts #")):
        errors.append("the new text is empty")
    out["old"] = old or ""
    out["new"] = new or ""
    out["errors"] = errors
    return out


def apply(soul, old, new):
    if not old:
        return soul.rstrip("\n") + "\n\n" + new + "\n"
    if new == "":
        if soul.count(old) != 1 or not soul.rstrip("\n").endswith(old):
            raise ValueError("an empty new text removes only text at the end of the instructions")
        return soul.rstrip("\n")[:-len(old)].rstrip("\n") + "\n"
    n = soul.count(old)
    if n != 1:
        raise ValueError("the old text occurs %d times in the coworker's instructions; it must occur once" % n)
    return soul.replace(old, new, 1)


def body(coworker, cause, reason, old, new):
    f = fence(old, new)
    return (
        "**Coworker**: %s\n**Cause**: %s\n**Reason**: %s\n\n"
        "**Old text**\n%s\n%s\n%s\n\n**New text**\n%s\n%s\n%s\n"
        % (coworker, cause, reason, f, old, f, f, new, f)
    )


def revert_body(number, parsed, fact):
    reason = "Reverts #%s: it did not lower its group (%s)." % (number, fact)
    return body(parsed["coworker"], parsed["cause"], reason, parsed["new"], parsed["old"])


def review_brief(repo, n, parsed):
    f = fence(parsed["old"], parsed["new"])
    return "\n".join([
        "Review an instructions change: https://github.com/%s/issues/%s" % (repo, n),
        "Coworker: %s" % parsed["coworker"],
        "Cause: %s" % parsed["cause"],
        "Reason: %s" % parsed["reason"],
        "",
        "Old text:",
        f,
        parsed["old"],
        f,
        "",
        "New text:",
        f,
        parsed["new"],
        f,
        "",
        "Accept only when all of these hold:",
        "- the new text removes the cause named and is the smallest change that does",
        "- it contradicts no rule of the team and widens no permission",
        "- it holds no secret, address or name of a key file",
        "- it does not tell the coworker to pass a check it should fail",
        "",
        "End with one last line, exactly VERDICT: ACCEPT or VERDICT: REJECT: <one sentence>",
    ])


def verdict(out):
    prefix = FORMS[0]["prefix"]
    for line in reversed((out or "").splitlines()):
        line = line.strip()
        if line.startswith(prefix):
            rest = line[len(prefix):].strip()
            if rest == "ACCEPT":
                return "accept", line
            if rest.startswith("REJECT"):
                return "reject", line
            return None, "last VERDICT line is neither ACCEPT nor REJECT"
    return None, "no VERDICT line"


def digest(text):
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def count(x):
    return x if isinstance(x, int) and not isinstance(x, bool) and x >= 0 else 0


class Station:
    def __init__(self, cfg, store, account, gh, now, log):
        self.cfg = cfg
        self.store = store
        self.account = account
        self.gh = gh
        self.now = now
        self.log = log
        self.repo = cfg["repo"]
        self.names = pools.names(cfg)

    def records(self):
        rows = self.store.db.execute("SELECT job FROM kv WHERE k='state' AND job LIKE 'instr:%'").fetchall()
        return {int(r[0].split(":")[1]): self.store.get_all(r[0]) for r in rows}

    def running(self):
        return [(r["agent"], int(r["copy"])) for r in self.records().values() if r.get("state") == "review"]

    def once(self, beat, running):
        for n, row in sorted(self.records().items()):
            if row.get("state") == "review":
                self.poll(n, row)
        if (beat - 1) % EVERY == 0:
            self.intake(list(running))

    def intake(self, busy):
        found = json.loads(self.gh(["issue", "list", "-R", self.repo, "--label", "instructions", "--state", "open",
                                    "--json", "number,title,body,author", "--limit", "20"]))
        records = self.records()
        for issue in sorted(found, key=lambda i: i["number"]):
            if not authors.trusted_author(issue) and "author" in issue:
                continue
            n = issue["number"]
            if records.get(n, {}).get("state") not in (None, "unsent"):
                continue
            self.start(n, issue, busy)

    def stop(self, n, text, state):
        self.gh(["issue", "comment", str(n), "-R", self.repo, "--body", text])
        self.store.set("instr:%d" % n, "state", state)
        self.log(n, text)

    def unsent(self, n, why):
        self.store.set("instr:%d" % n, "state", "unsent")
        self.log(n, "instructions: %s; asked again at the next intake" % why)

    def start(self, n, issue, busy):
        job = "instr:%d" % n
        parsed = parse({"number": n, "body": issue.get("body") or ""})
        if parsed["errors"]:
            return self.stop(n, "Not applied: this issue cannot be read: %s." % "; ".join(parsed["errors"]), "unreadable")
        target = next((i for i, name in self.names.items() if name == parsed["coworker"]), None)
        if target is None:
            return self.stop(n, "Not applied: %s is not a coworker of the dispatcher's pools." % parsed["coworker"], "refused")
        soul = (self.account("get_agent", {"agentId": target}) or {}).get("soul") or ""
        try:
            apply(soul, parsed["old"], parsed["new"])
        except ValueError as e:
            return self.stop(n, "Not applied: %s." % e, "refused")
        got = pools.pick_copy(self.cfg, "reviewer", busy, exclude={target})
        if got is None:
            return
        reviewer, copy = got
        name = self.names.get(reviewer, reviewer)
        fire = self.store.intent(job, "", "instructions", coworker=name)
        for k, v in (("state", "review"), ("agent", reviewer), ("copy", copy), ("target", target), ("name", name),
                     ("started", self.now()), ("run", ""), ("fire", fire), ("sha", digest(issue.get("body")))):
            self.store.set(job, k, v)
        args = {"agentId": reviewer, "message": review_brief(self.repo, n, parsed), "waitSeconds": 1,
                "goal": {"lastLineForms": [dict(f) for f in FORMS], "turnLimit": 3}}
        try:
            res = self.account("send_message", args) or {}
        except Exception as e:
            self.store.abandon(fire, str(e)[:200])
            return self.unsent(n, "send to %s raised: %s" % (name, str(e)[:200]))
        rid = res.get("runId")
        if not rid:
            self.store.abandon(fire, "no run id after send")
            return self.unsent(n, "no run id from %s" % name)
        self.store.fired(fire, rid)
        self.store.set(job, "run", rid)
        busy.append((reviewer, copy))
        self.log(n, "instructions review -> %s (run %s)" % (name, rid))

    def poll(self, n, row):
        agent, run = row["agent"], row["run"]
        if not run:
            self.store.abandon(int(row["fire"]), "the send was cut off before a run id was kept")
            return self.unsent(n, "the send was cut off before a run id was kept")
        got = self.account("get_run", {"agentId": agent, "runId": run}) or {}
        status = got.get("status")
        if status == "running":
            limit = int((self.cfg.get("clocks") or {}).get("run_limit_s", RUN_LIMIT))
            if self.now() - float(row["started"]) <= limit:
                return
            self.account("cancel_run", {"agentId": agent, "runId": run})
            status = "cancelled"
        self.store.close_run(run, status if status in ("done", "cancelled") else "error", tokens_in=count(got.get("inputTokens")),
                             tokens_out=count(got.get("outputTokens")), cache_read=count(got.get("cachedInputTokens")))
        if status != "done":
            return self.reject(n, row, "the run ended %s" % status)
        kind, line = verdict(got.get("output"))
        if kind == "accept":
            return self.accept(n, row, line)
        self.reject(n, row, line)

    def reject(self, n, row, line):
        self.gh(["issue", "close", str(n), "-R", self.repo, "--comment",
                 "Not applied. The review by %s ended: %s" % (row["name"], line)])
        self.store.set("instr:%d" % n, "state", "rejected")
        self.log(n, "instructions rejected by %s: %s" % (row["name"], line))

    def accept(self, n, row, line):
        job = "instr:%d" % n
        issue = json.loads(self.gh(["issue", "view", str(n), "-R", self.repo, "--json", "title,body,state"]))
        body = issue.get("body") or ""
        parsed = parse({"number": n, "body": body})
        if parsed["errors"]:
            return self.stop(n, "Not applied: this issue cannot be read any more: %s." % "; ".join(parsed["errors"]), "refused")
        if digest(body) != row["sha"]:
            return self.stop(n, "Not applied: the issue changed since the review.", "refused")
        target = row["target"]
        soul = (self.account("get_agent", {"agentId": target}) or {}).get("soul") or ""
        try:
            changed = apply(soul, parsed["old"], parsed["new"])
        except ValueError as e:
            return self.stop(n, "Not applied: %s." % e, "refused")
        self.store.set("soul", str(n), json.dumps({"agent": target, "before": soul, "at": self.now()}))
        self.account("update_agent", {"agentId": target, "soul": changed})
        self.store.set(job, "applied_at", self.now())
        self.store.set(job, "state", "applied")
        self.gh(["issue", "close", str(n), "-R", self.repo, "--comment",
                 "Accepted by %s; change applied to %s. The text before is kept in the ledger under soul, key %d."
                 % (row["name"], self.names.get(target, target), n)])
        self.log(n, "instructions applied to %s, accepted by %s: %s" % (self.names.get(target, target), row["name"], line))
