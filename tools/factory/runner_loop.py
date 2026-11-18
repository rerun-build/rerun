#!/usr/bin/env python3
import argparse, base64, json, os, signal, subprocess, sys, tempfile, threading, time, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import applypatch as AP, batch as BT, checkout as CO, engine as E, evidence as EV, factory as F, ghclient as GH, intake as IN, limits as L, roster, publish as PB, followups as FU, readyq as RQ, store as S, testrun as TR, trigger as T, wake
from publish import body as pr_body

POLL_S = 30
INBOX_NAME = "inbox"

def log(msg):
    print("runner: " + msg, flush=True)

def store_path(cfg):
    return cfg.get("store_file") or os.path.join(os.environ.get("FACTORY_DATA_DIR", "/state"), "ledger.db")

STATE_NAME = "runner-state.json"
STUB = {"name": "stub", "provider": "custom", "baseUrl": "http://stub-model:8080/v1", "models": ["stub-fast", "stub-hold"]}
DEFAULT_MODEL = "stub-fast"

class NeedsSetup(RuntimeError):
    pass

def state_path(cfg):
    return cfg.get("state_file") or os.path.join(os.path.dirname(store_path(cfg)), STATE_NAME)

def read_state(cfg):
    try:
        with open(state_path(cfg), encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        raise RuntimeError("cannot read the state file; run setup again") from None
    return data if isinstance(data, dict) else {}

def write_state(cfg, state):
    path = state_path(cfg)
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".state-", dir=d)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(state, f, sort_keys=True, indent=1)
    os.replace(tmp, path)

def resolve(cfg, state, strict=True):
    out = dict(cfg)
    out["triggers"] = []
    for e in cfg["triggers"]:
        e = dict(e)
        if not e.get("agent"):
            aid = (state.get("agents") or {}).get(e.get("agent_name") or e["stage"])
            if not aid:
                if strict:
                    raise NeedsSetup("no coworker id for stage %s: run `runner_loop.py setup` first" % e["stage"])
                continue
            e["agent"] = aid
        out["triggers"].append(e)
    return out

def load_runtime(cfg=None, strict=True):
    cfg = cfg if cfg is not None else T.load_config()
    return resolve(cfg, read_state(cfg), strict)

def setup(eng, cfg):
    out, state = [], read_state(cfg)
    listing = eng._call("GET", "/connections")
    conn = next((c for c in listing.get("connections") or [] if c.get("name") == STUB["name"] and c.get("provider") == "custom"), None)
    if conn is None:
        conn = eng._call("POST", "/connections", payload=dict(STUB))
        out.append("stub connection created: %s" % conn["id"])
        listing = eng._call("GET", "/connections")
    else:
        out.append("stub connection reused: %s" % conn["id"])
    cur = listing.get("default") or {}
    if cur.get("connectionId") != conn["id"] or cur.get("model") != DEFAULT_MODEL:
        eng._call("PUT", "/connections/default", payload={"connectionId": conn["id"], "model": DEFAULT_MODEL})
        out.append("stub connection set as default, model %s" % DEFAULT_MODEL)
    index = {a.get("id"): a for a in eng._call("GET", "/agents").get("agents") or []}
    by_name = {a.get("name"): a for a in index.values()}
    agents = dict(state.get("agents") or {})
    for e in cfg["triggers"]:
        name = e.get("agent_name")
        if e.get("agent") or not name:
            continue
        aid = agents.get(name)
        if aid in index:
            out.append("coworker %s reused: %s" % (name, aid))
        elif name in by_name:
            aid = by_name[name]["id"]
            out.append("coworker %s reused: %s" % (name, aid))
        else:
            row = eng._call("POST", "/agents", payload={"config": {
                "name": name, "description": "Factory stage coworker (dev engine, stub model)",
                "connectionId": conn["id"], "provider": "custom", "model": e.get("model") or DEFAULT_MODEL}})
            aid = row["id"]
            by_name[name] = row
            out.append("coworker %s created: %s" % (name, aid))
        agents[name] = aid
    state = {"connection": conn["id"], "agents": agents}
    write_state(cfg, state)
    T.ensure_triggers(eng, resolve(cfg, state))
    out.append("triggers ensured")
    return out

def iso(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))

def inbox_path(cfg):
    return cfg.get("inbox_dir") or os.path.join(os.path.dirname(store_path(cfg)), INBOX_NAME)

def enqueue(inbox, job, stage, chunk="", payload=None):
    os.makedirs(inbox, exist_ok=True)
    body = {"job": job, "stage": stage, "chunk": chunk, "payload": payload or {"job": job, "stage": stage, "chunk": chunk}}
    name = "%013d-%s.json" % (int(time.time() * 1000), uuid.uuid4().hex[:8])
    fd, tmp = tempfile.mkstemp(prefix=".req-", dir=inbox)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(body, f)
    os.replace(tmp, os.path.join(inbox, name))
    return name

def ingest(st, inbox):
    try:
        names = sorted(n for n in os.listdir(inbox) if n.endswith(".json") and not n.startswith("."))
    except FileNotFoundError:
        return 0
    n = 0
    for name in names:
        path = os.path.join(inbox, name)
        try:
            with open(path, encoding="utf-8") as f:
                req = json.load(f)
            job, stage = str(req["job"]), str(req["stage"])
            payload = req.get("payload")
            if payload is not None and not isinstance(payload, dict):
                raise ValueError("payload is not an object")
        except (OSError, ValueError, KeyError, TypeError) as e:
            log("bad request file %s: %s" % (name, type(e).__name__))
            try:
                os.replace(path, path + ".bad")
            except OSError:
                pass
            continue
        st.enqueue(job, stage, str(req.get("chunk") or ""), payload)
        os.unlink(path)
        n += 1
    return n

class ChainFailed(Exception):
    pass


class Runner:
    def __init__(self, eng, st, cfg, tokens, clock=time.time, open_pr=lambda *a: None, evidence=None, issues=None, pr_by_head=None, compare_diff=None):
        self.open_pr, self.evidence, self.issues, self.pr_by_head, self.compare_diff = open_pr, evidence, issues, pr_by_head, compare_diff
        self.eng, self.st, self.cfg, self.tokens, self.clock = eng, st, cfg, tokens, clock
        self.by_slug = {e["slug"]: e for e in cfg["triggers"]}
        self.by_stage = {e["stage"]: e for e in cfg["triggers"]}

    def tick(self):
        ingest(self.st, inbox_path(self.cfg))
        self.resolve_pending()
        for f in self.st.running():
            try:
                self.check(f)
            except (E.EngineError, T.TriggerError) as e:
                log("read of run %s failed, will retry: %s" % (f["run_id"], e))
        self.see_merges()
        self.sweep_leases()
        self.start_queued()
        self.start_ready()

    def _agent(self, f):
        e = self.by_slug.get(f["slug"])
        return e["agent"] if e else None

    def resolve_pending(self):
        for f in self.st.pending():
            agent = self._agent(f)
            if not agent:
                self.st.abandon(f["id"], "no trigger entry for slug")
                continue
            try:
                rows = [T.map_run(r) for r in self.eng.list_runs(agent)]
            except E.EngineError as e:
                log("cannot list runs of %s: %s" % (agent, e))
                continue
            taken = self.st.known_run_ids()
            rows = [r for r in rows if r and r["id"] not in taken]
            what, val = L.resolve_pending(f["intent_at"], f["slug"], rows, self.clock(), self.cfg.get("poll_s", POLL_S))
            if what == "RUN":
                self.st.fired(f["id"], val)
            elif what == "FAILED":
                self.st.abandon(f["id"], val)
                log("fire %d abandoned: %s" % (f["id"], val))

    def _steps(self, agent, f, row):
        tokens = (row.get("input_tokens") or 0) + (row.get("output_tokens") or 0)
        last = None
        try:
            for s in self.eng.run_steps(agent, f["run_id"]):
                t = s.get("finishedAt") or s.get("startedAt") or s.get("createdAt")
                if t and (last is None or L.ts(t) > L.ts(last)):
                    last = t
            ok = True
        except E.EngineError:
            ok = False
        return {"last_step_at": last, "tokens": tokens} if ok else {"tokens": tokens}

    def check(self, f):
        agent = self._agent(f)
        if not agent:
            self.st.close_run(f["run_id"], "failed", error="no trigger entry for slug")
            return
        row = T.read_run(self.eng, agent, f["run_id"])
        steps = self._steps(agent, f, row) if row and row.get("status") == "running" else None
        what, why = L.run_outcome(row, self.clock(), steps, L.stage_cfg(self.cfg, self.by_slug.get(f["slug"])))
        tin, tout = (row or {}).get("input_tokens") or 0, (row or {}).get("output_tokens") or 0
        rid = f["run_id"]
        if what == "RUNNING":
            return
        if what == "DONE" and self.lease_closed(f):
            self.st.close_run(rid, "discarded", iso(self.clock()), tin, tout, "result under a closed lease")
            log("run %s result discarded: lease of chunk %s closed" % (rid, f["chunk"]))
        elif what == "DONE":
            if f["stage"] == "build" and f["chunk"] and "published:" + f["chunk"] not in self.st.get_all(f["job"]):
                try:
                    self.finish_build(f)
                except ChainFailed as e:
                    return self.chain_failed(f, str(e), tin, tout)
            ev = self.evidence(f) if self.evidence else ("OK", "")
            if ev[0] != "OK":
                return
            if f["stage"] == "review" and self.issues and isinstance(ev[1], str):
                self.follow_up(f["job"], ev[1])
            self.st.close_run(rid, "done", iso(self.clock()), tin, tout)
        elif what == "CANCEL":
            self.eng.cancel(agent, rid)
            self.st.close_run(rid, "cancelled", iso(self.clock()), tin, tout, why)
            log(why)
        elif what in ("REFIRE_ONCE", "RESTARTED"):
            n = self.st.refires(f["job"], f["chunk"], f["stage"])
            ok = (n < 1) if what == "REFIRE_ONCE" else L.restart(n)[0] == "REFIRE"
            err = why or L.RESTARTED
            if ok:
                self.st.close_run(rid, "error", iso(self.clock()), tin, tout, err)
                self.requeue(f)
                log("run %s ended in error, stage %s queued again once" % (rid, f["stage"]))
            else:
                self.st.close_run(rid, "failed", iso(self.clock()), tin, tout, err)
                log("run %s failed: refire already used" % rid)
        else:
            self.st.close_run(rid, "failed", iso(self.clock()), tin, tout, why)

    def follow_up(self, job, verdict):
        kv = self.st.get_all(job)
        done = {k[9:] for k in kv if k.startswith("followup:")}
        try:
            for k in FU.create(self.issues, FU.notes(verdict, job), done):
                self.st.set(job, "followup:" + k, "1")
        except (OSError, RuntimeError) as e:
            log("follow-up issues for %s stopped: %s" % (job, type(e).__name__))

    def chain_failed(self, f, why, tin, tout):
        what, note = L.failure(self.st.attempts(f["job"], f["chunk"]), self.cfg, why)
        self.st.close_run(f["run_id"], "error" if what == "RETRY" else "failed", iso(self.clock()), tin, tout, note or why)
        if what == "RETRY":
            return self.requeue(f)
        self.st.set_ready_state(f["job"], f["chunk"], "needs_boss")
        log("chunk %s of job %s escalated: %s" % (f["chunk"], f["job"], note))

    def finish_build(self, f):
        job, chunk = f["job"], f["chunk"]
        kv, paths = self.st.get_all(job), self.st.get_ready(job, chunk)["paths"]
        if "repo_url" not in kv:
            return log("chunk %s: job %s has no repo_url, nothing to publish" % (chunk, job))
        d = self.cfg.get("work_dir") or os.path.join(os.path.dirname(store_path(self.cfg)), "work")
        try:
            base, head = (CO.Checkout(os.path.join(d, job, n), kv["repo_url"], kv["base"]).ensure() for n in ("base", "head"))
            if "patch:" + chunk not in kv and self.compare_diff:
                kv["patch:" + chunk] = self.compare_diff(kv["base"], "chunk/%s-%s" % (job, chunk))
                self.st.set(job, "patch:" + chunk, kv["patch:" + chunk])
            if (r := AP.apply(head, kv["patch:" + chunk], paths)) != "applied":
                raise ChainFailed("patch %s" % r)
            res = TR.run(base, head, kv["test:" + chunk].split())
            if res["verdict"] != "ok":
                raise ChainFailed("done-test %s" % res["verdict"])
            self.st.set(job, "receipt:" + chunk, json.dumps(res))
            repo = kv["repo_url"].replace("https://github.com/", "", 1)
            text = pr_body("%s#%s" % (repo, job), unmerged_receipts(self.st, job))
            PB.publish(head, job, kv["title"], kv["base_branch"], lambda t, h, b, _="": self.open_pr(t, h, b, text), paths)
            self.st.set(job, "published:" + chunk, "1")
            self.run_gate(repo, job)
        except (KeyError, ValueError, OSError, subprocess.CalledProcessError, GH.GhError) as e:
            raise ChainFailed("publish chain stopped: %s" % type(e).__name__) from e

    def run_gate(self, repo, job):
        try:
            pr = self.pr_by_head and self.pr_by_head("factory/job-%s" % job)
            if not pr:
                return log("gate skipped for job %s: no PR found" % job)
            env = dict(os.environ, GATE_POST_STATUS="1", FACTORY_GH="gh",
                       FACTORY_WORK=os.path.join(os.environ.get("FACTORY_DATA_DIR", "/state"), "work"))
            p = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "gate.py"), repo, str(pr["number"])],
                               env=env, capture_output=True, text=True, timeout=600)
            log("gate %s#%s exit %s" % (repo, pr["number"], p.returncode))
        except Exception as e:
            log("gate for job %s did not run: %s" % (job, type(e).__name__))

    def see_merges(self):
        if not self.pr_by_head:
            return
        for (job,) in self.st.db.execute("SELECT DISTINCT job FROM ready_chunks WHERE state='running'").fetchall():
            done = [r[0] for r in self.st.db.execute("SELECT chunk FROM ready_chunks WHERE job=? AND state='running'", (job,))
                    if "published:" + r[0] in self.st.get_all(job)]
            try:
                pr = done and self.pr_by_head("factory/job-%s" % job)
            except GH.GhError as e:
                log("merge check of job %s failed, will retry: %s" % (job, e))
                continue
            if pr and pr["merged"]:
                for c in done:
                    self.st.set_ready_state(job, c, "merged")

    def requeue(self, f):
        if f["chunk"]:
            for l in self.st.open_leases():
                if l["job"] == f["job"] and l["chunk"] == f["chunk"] and l.get("attempt", 0) == f["refire"]:
                    self.st.close_lease(l["id"], "requeued", at=iso(self.clock()))
            self.st.bump_attempt(f["job"], f["chunk"])
            self.st.set_ready_state(f["job"], f["chunk"], "ready")
        else:
            payload = {"job": f["job"], "stage": f["stage"], "chunk": f["chunk"]}
            st = self.st.get_all(f["job"]).get("payload:" + f["stage"])
            if st:
                payload = json.loads(st)
            self.st.enqueue(f["job"], f["stage"], f["chunk"], payload)

    def start_queued(self):
        busy = {f["job"] for f in self.st.pending() + self.st.running()}
        for q in self.st.queued(iso(self.clock())):
            job, stage = q["job"], q["stage"]
            if job in busy:
                continue
            ent = self.by_stage.get(stage)
            if not ent:
                log("no trigger for stage %s of job %s, dropped" % (stage, job))
                self.st.dequeue(q["id"])
                continue
            if L.may_fire(self.st.fire_count(job))[0] != "FIRE":
                log("job %s hit the fire cap, stage %s dropped" % (job, stage))
                self.st.dequeue(q["id"])
                continue
            if self.over_total(job):
                log("job %s is over its token total, stage %s dropped" % (job, stage))
                self.st.dequeue(q["id"])
                continue
            if L.packet_oversize(json.dumps(q["payload"]), self.cfg):
                log("job %s stage %s: packet over the cap, refused" % (job, stage))
                self.st.dequeue(q["id"])
                continue
            token = self.tokens.get("%s/%s" % (ent["agent"], ent["slug"]))
            if not token:
                log("no token for %s, skipped" % ent["slug"])
                continue
            self.st.set(job, "payload:" + stage, json.dumps(q["payload"]))
            fid = self.st.dequeue_to_intent(q["id"], job, q["chunk"], stage, ent.get("coworker", ""), ent["slug"])
            busy.add(job)
            try:
                run_id, _ = T.fire(self.eng, ent["agent"], ent["slug"], token, q["payload"])
            except T.TriggerError as e:
                log("fire of %s failed (kept as intent, resolved next tick): %s" % (ent["slug"], e))
                continue
            self.st.fired(fid, run_id)
            log("fired stage %s of job %s: run %s" % (stage, job, run_id))

    def over_total(self, job):
        cap = L._pos(self.cfg.get("job_token_cap"))
        used = self.st.db.execute("SELECT COALESCE(SUM(tokens_in+tokens_out),0) FROM fires WHERE job=?", (job,)).fetchone()[0]
        return bool(cap) and used >= cap

    def lease_closed(self, f):
        ls = [l for l in self.st.db.execute("SELECT closed_at FROM leases WHERE job=? AND chunk=? AND attempt=?",
                                            (f["job"], f["chunk"], f["refire"]))] if f["chunk"] else []
        return bool(ls) and all(l[0] for l in ls)

    def sweep_leases(self):
        at = iso(self.clock())
        for l in self.st.open_leases():
            mine = lambda f: f["chunk"] == l["chunk"]
            if l["expires_at"] >= at or any(mine(f) for f in self.st.pending(l["job"])):
                continue
            try:
                for f in filter(mine, self.st.running(l["job"])):
                    row = T.read_run(self.eng, self._agent(f), f["run_id"])
                    if row and row.get("status") == "done":
                        self.st.close_run(f["run_id"], "done", at)
                        continue
                    if row and row.get("status") == "running":
                        self.eng.cancel(self._agent(f), f["run_id"])
                    self.st.close_run(f["run_id"], "cancelled", at, error="lease expired")
            except (E.EngineError, T.TriggerError) as e:
                log("lease %s kept open, cancel failed: %s" % (l["id"], e))
                continue
            self.st.close_lease(l["id"], "expired", at=at)

    def fire_reviews(self, job, pr, head, checks, owners):
        if F.ci_state(checks) != "GREEN":
            return []
        new = [o for o in sorted(set(owners)) if wake.claim_wake(self.st, wake.review_event(pr), o, head)]
        for o in new:
            self.st.enqueue(job, "review", "", {"job": job, "stage": "review", "owner": o, "head": head})
        return new

    def after_reject(self, job, chunk, owners):
        what, why = L.after_reject(owners)
        if what == "ARBITER":
            self.st.enqueue(job, "arbiter", chunk, {"job": job, "stage": "arbiter", "chunk": chunk, "why": why})
        return what

    def fire_batch(self, batch):
        ent = self.by_stage.get("build")
        token = ent and self.tokens.get("%s/%s" % (ent["agent"], ent["slug"]))
        if not token or not batch:
            return None
        job, ids = batch[0]["job"], [c["chunk"] for c in batch]
        exp = iso(self.clock() + 2 * self.cfg.get("run_limit_s", 600))
        payload = {"job": job, "stage": "build", "chunks": ids}
        fid = self.st.dequeue_to_intent(self.st.enqueue(job, "build", ids[0], payload), job, ids[0], "build",
                                        ent.get("coworker", ""), ent["slug"], batch[0]["paths"], exp)
        fids = [fid]
        for c in batch[1:]:
            self.st.grant_lease(job, c["chunk"], c["paths"], exp, attempt=self.st.attempts(job, c["chunk"]))
            fids.append(self.st.intent(job, c["chunk"], "build", ent.get("coworker", ""), ent["slug"]))
        for c in ids:
            self.st.set_ready_state(job, c, "running")
        try:
            run_id, _ = T.fire(self.eng, ent["agent"], ent["slug"], token, payload)
        except T.TriggerError as e:
            log("fire of batch %s failed (kept as intents): %s" % (ids, e))
            return None
        for f in fids:
            self.st.fired(f, run_id)
        return run_id

    def start_ready(self):
        ent = self.by_stage.get("build")
        fires = self.st.pending() + self.st.running()
        busy, stages = [(f["job"], f["chunk"]) for f in fires if f["chunk"]], sum(1 for f in fires if not f["chunk"])
        merged = {r[0] for r in self.st.db.execute("SELECT chunk FROM ready_chunks WHERE state='merged'")}
        token = ent and self.tokens.get("%s/%s" % (ent["agent"], ent["slug"]))
        left = [c for c in self.st.ready_list() if not self.over_total(c["job"])]
        while token and left:
            first = next((c for c in left if RQ.eligible(c, self._ready_state(merged, busy, stages, c["job"]))[0]), None)
            if not first:
                return
            same = [c for c in left if c["job"] == first["job"]]
            batch = BT.pick_batch(same, self._ready_state(merged, busy, stages, first["job"]))
            run_id = self.fire_batch(batch)
            left = [c for c in left if c not in batch]
            busy += [(c["job"], c["chunk"]) for c in batch]
            log("fired chunks %s of job %s: run %s" % ([c["chunk"] for c in batch], first["job"], run_id))

    def _ready_state(self, merged, busy, stages, job):
        return {"merged": merged, "busy": busy, "stages": stages, "leases": self.st.open_leases(),
                "fired": self.st.fire_count(job), "cfg": self.cfg}

TOKEN_FILE = "/run/secrets/gh_token"

def load_token(cfg):
    path = cfg.get("gh_token_file") or TOKEN_FILE
    try:
        with open(path, encoding="utf-8") as f:
            tok = f.read().strip()
    except OSError as e:
        raise RuntimeError("token file %s cannot be read (%s)" % (path, e.strerror or type(e).__name__))
    if not tok:
        raise RuntimeError("token file %s is empty" % path)
    os.environ["GH_TOKEN"] = os.environ["FACTORY_GIT_TOKEN"] = tok

def build(cfg=None, eng=None, clock=time.time, gh=None):
    cfg = load_runtime(cfg)
    gh = gh or GH.Client(cfg.get("github_api", "https://api.github.com"), cfg.get("repo", "special-place-ai-heaven/moldwright"))
    eng = eng or E.Engine()
    tokens = T.ensure_triggers(eng, cfg)
    st = S.Store(store_path(cfg))
    return Runner(eng, st, cfg, tokens, clock, open_pr=gh.open_pr, issues=gh, pr_by_head=lambda b: gh.pr_by_head(b), compare_diff=getattr(gh, "compare_diff", None), evidence=lambda f: stage_evidence(gh, st, f))

def unmerged_receipts(st, job):
    merged = {c for (c,) in st.db.execute("SELECT chunk FROM ready_chunks WHERE job=? AND state='merged'", (job,))}
    return {k[8:]: json.loads(v) for k, v in st.get_all(job).items() if k.startswith("receipt:") and k[8:] not in merged}

def stage_evidence(gh, st, f):
    kv = st.get_all(f["job"])
    if f["stage"] != "build" or "repo_url" not in kv:
        return "OK", ""
    try:
        return EV.stage_check(gh.get, f, kv, st.get_ready(f["job"], f["chunk"]))
    except GH.GhError as e:
        return "NONE", str(e)

TRUSTED_ASSOCIATIONS = ("OWNER", "MEMBER", "COLLABORATOR")
FACTORY_LOGIN = "special-place-administrator"

def _trusted(item):
    return item.get("author_association") in TRUSTED_ASSOCIATIONS or (item.get("user") or {}).get("login") == FACTORY_LOGIN

def dev_roster(gh):
    try:
        got = gh.get("/contents/tools/factory/roster.json?ref=dev")
    except GH.GhError as e:
        if e.status == 404:
            return None
        raise
    return roster.load(base64.b64decode(got["content"]).decode("utf-8"))

def intake_issue(st, gh, repo, n, base_branch="dev"):
    issue = gh.issue(n)
    parts = [issue.get("body") or ""] if _trusted(issue) else []
    text = "\n".join(parts + [c.get("body") or "" for c in gh.comments(n) if _trusted(c)])
    meta = {"repo_url": "https://github.com/" + repo, "title": issue["title"], "base_branch": base_branch}
    sha = gh.branch_sha(base_branch)
    state, errors = IN.register(st, str(n), meta, text, dev_roster(gh))
    if state:
        st.set(str(n), "base", sha)
    return state, errors

def run(r, stop, poll_s):
    log("started")
    while not stop.is_set():
        try:
            r.tick()
        except (E.EngineError, T.TriggerError) as e:
            log("tick failed: %s" % e)
        stop.wait(poll_s)
    log("stopped")

def main(argv=None):
    ap = argparse.ArgumentParser(prog="runner_loop")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run")
    sub.add_parser("once")
    sub.add_parser("setup")
    en = sub.add_parser("enqueue")
    en.add_argument("job")
    en.add_argument("stage")
    en.add_argument("--chunk", default="")
    en.add_argument("--payload-file", help="JSON file used as the packet payload")
    ik = sub.add_parser("intake")
    ik.add_argument("ref", help="REPO#N, e.g. owner/name#71")
    ik.add_argument("--base", default="dev")
    a = ap.parse_args(argv)
    cfg = T.load_config()
    if a.cmd == "intake":
        repo, _, n = a.ref.rpartition("#")
        st = S.Store(store_path(cfg))
        try:
            state, errors = intake_issue(st, GH.Client(cfg.get("github_api", "https://api.github.com"), repo), repo, int(n), a.base)
        except (GH.GhError, ValueError) as e:
            print("intake failed: %s" % e, file=sys.stderr)
            return 1
        finally:
            st.close()
        for e in errors:
            print("rejected: " + e, file=sys.stderr)
        print("job %s: %s" % (n, "registered %d chunks" % len(state["chunks"]) if state else "no valid chunk"))
        return 0 if state else 1
    if a.cmd == "enqueue":
        payload = None
        if a.payload_file:
            with open(a.payload_file, encoding="utf-8") as f:
                payload = json.load(f)
        enqueue(inbox_path(cfg), a.job, a.stage, a.chunk, payload)
        print("queued %s %s" % (a.job, a.stage))
        return 0
    if a.cmd == "setup":
        try:
            for line in setup(E.Engine(), cfg):
                print(line)
        except (E.EngineError, T.TriggerError, RuntimeError, KeyError, OSError) as e:
            print("setup failed: %s" % ("unexpected engine answer" if isinstance(e, KeyError) else e), file=sys.stderr)
            return 1
        return 0
    try:
        load_token(cfg)
    except RuntimeError as e:
        print("runner: cannot start: %s" % e, file=sys.stderr)
        return 1
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    while True:
        try:
            r = build(cfg)
            break
        except NeedsSetup as e:
            if a.cmd == "once":
                print("runner: %s" % e, file=sys.stderr)
                return 1
            log("waiting for setup: %s" % e)
            if stop.wait(10):
                return 0
        except (E.EngineError, T.TriggerError, RuntimeError) as e:
            print("runner: cannot start: %s" % e, file=sys.stderr)
            return 1
    if a.cmd == "once":
        r.tick()
        r.st.close()
        return 0
    run(r, stop, cfg.get("poll_s", POLL_S))
    r.st.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
