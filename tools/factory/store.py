import fcntl, json, os, sqlite3, time
from gist import gist

import states

SCHEMA = """
CREATE TABLE IF NOT EXISTS fires(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL, chunk TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL,
  coworker TEXT NOT NULL DEFAULT '', slug TEXT NOT NULL DEFAULT '',
  intent_at TEXT NOT NULL, run_id TEXT, status TEXT NOT NULL DEFAULT 'intent',
  ended_at TEXT, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  error TEXT, refire INTEGER NOT NULL DEFAULT 0);
DROP INDEX IF EXISTS fires_run;  -- was UNIQUE: chunks of one batch share a run id; an index drop, no row change
CREATE INDEX IF NOT EXISTS fires_run_id ON fires(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fires_job ON fires(job, id);
CREATE TABLE IF NOT EXISTS kv(job TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY(job, k));
CREATE TABLE IF NOT EXISTS moves(job TEXT PRIMARY KEY, state TEXT NOT NULL, prev TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL, stage TEXT NOT NULL, chunk TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL, enqueued_at TEXT NOT NULL, not_before TEXT);
CREATE TABLE IF NOT EXISTS ready_chunks(
  job TEXT NOT NULL, chunk TEXT NOT NULL, builder TEXT NOT NULL DEFAULT '',
  paths TEXT NOT NULL DEFAULT '[]', deps TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'ready', attempts INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL, PRIMARY KEY(job, chunk));
CREATE TABLE IF NOT EXISTS leases(
  id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, chunk TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0, paths TEXT NOT NULL DEFAULT '[]',
  granted_at TEXT NOT NULL, expires_at TEXT NOT NULL, closed_at TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS wakes(
  event TEXT NOT NULL, coworker TEXT NOT NULL, head TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY(event, coworker, head));
CREATE TABLE IF NOT EXISTS jobs(
  job TEXT PRIMARY KEY, state TEXT NOT NULL, pr INTEGER, head TEXT, round INTEGER,
  data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transitions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, at TEXT NOT NULL,
  from_state TEXT, to_state TEXT NOT NULL, reason TEXT, round INTEGER, run_id TEXT);
CREATE INDEX IF NOT EXISTS transitions_job ON transitions(job, id);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, key TEXT NOT NULL, old TEXT, new TEXT);
CREATE TABLE IF NOT EXISTS failures(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, job TEXT NOT NULL,
  station TEXT NOT NULL DEFAULT '', coworker TEXT NOT NULL DEFAULT '', model TEXT, tier TEXT,
  reason TEXT NOT NULL DEFAULT '', plan_run TEXT, brief TEXT);
CREATE TABLE IF NOT EXISTS briefs(hash TEXT PRIMARY KEY, state TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS changes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, issue INTEGER NOT NULL, grp TEXT NOT NULL,
  kind TEXT NOT NULL, before REAL, live_at REAL, after REAL, verdict TEXT, revert INTEGER,
  told INTEGER NOT NULL DEFAULT 0);
"""
JOB_STATES = states.NAMES
FIRE_COLUMNS = (("cache_read", "INTEGER"), ("cache_write", "INTEGER"), ("seconds", "INTEGER"),
                ("steps", "INTEGER"), ("steps_at", "TEXT"), ("model", "TEXT"), ("thinking", "TEXT"))
FAILURE_COLUMNS = (("runs", "INTEGER"), ("cost", "REAL"))
OPEN = ("intent", "running")
CHANGE_COLUMNS = {"live_at", "after", "verdict", "revert", "told"}


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class Refused(RuntimeError):
    pass


class Store:
    def __init__(self, path):
        self.path = path
        self._lock = open(path + ".lock", "a")
        try:
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._lock.close()
            raise RuntimeError("store is locked by another writer")
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript(SCHEMA)
        have = {r[1] for r in self.db.execute("PRAGMA table_info(fires)")}
        for col, typ in FIRE_COLUMNS:
            if col not in have:
                self.db.execute(f"ALTER TABLE fires ADD COLUMN {col} {typ}")
        have = {r[1] for r in self.db.execute("PRAGMA table_info(failures)")}
        for col, typ in FAILURE_COLUMNS:
            if col not in have:
                self.db.execute(f"ALTER TABLE failures ADD COLUMN {col} {typ}")

    def close(self):
        self.db.close()
        self._lock.close()

    def claim(self, project, home):
        row = self.db.execute("SELECT v FROM kv WHERE job='-' AND k='project_of'").fetchone()
        if row is not None and row[0] != project:
            raise Refused("the ledger %s belongs to %s, not to %s" % (os.path.basename(self.path), row[0], project))
        if row is None:
            held = any(self.db.execute("SELECT 1 FROM %s LIMIT 1" % t).fetchone() for t in ("jobs", "fires", "transitions"))
            if held and project != home:
                raise Refused("the ledger %s holds rows and names no project" % os.path.basename(self.path))
            self.set("-", "project_of", project)

    def intent(self, job, chunk, stage, coworker="", slug="", at=None, model=None, thinking=None):
        n = self.db.execute("SELECT COUNT(*) FROM fires WHERE job=? AND chunk=? AND stage=?",
                            (job, chunk, stage)).fetchone()[0]
        cur = self.db.execute(
            "INSERT INTO fires(job,chunk,stage,coworker,slug,intent_at,refire,model,thinking) VALUES(?,?,?,?,?,?,?,?,?)",
            (job, chunk, stage, coworker, slug, at or now(), n, model, thinking))
        self._seen(job, chunk)
        self.db.execute("UPDATE ready_chunks SET attempts=MAX(attempts,?) WHERE job=? AND chunk=?", (n, job, chunk))
        return cur.lastrowid

    def fired(self, fire_id, run_id):
        self.db.execute("UPDATE fires SET run_id=?, status='running' WHERE id=? AND status='intent'",
                        (run_id, fire_id))

    def close_run(self, run_id, status, at=None, tokens_in=0, tokens_out=0, error=None,
                  cache_read=None, cache_write=None):
        at = at or now()
        self.db.execute("UPDATE fires SET status=?, ended_at=?, tokens_in=?, tokens_out=?, error=?, cache_read=?, "
                        "cache_write=?, seconds=MAX(0, CAST(strftime('%s', ?) AS INTEGER) - CAST(strftime('%s', intent_at) AS INTEGER)) "
                        "WHERE run_id=?", (status, at, tokens_in, tokens_out, error, cache_read, cache_write, at, run_id))

    def stage_cost(self, run_id):
        r = self.db.execute("SELECT job,chunk,stage,status,tokens_in,tokens_out,cache_read,cache_write,seconds "
                            "FROM fires WHERE run_id=?", (run_id,)).fetchone()
        return dict(r) if r else None

    def abandon(self, fire_id, error="no run id after intent", at=None):
        self.db.execute("UPDATE fires SET status='lost', ended_at=?, error=? WHERE id=? AND run_id IS NULL",
                        (at or now(), error, fire_id))

    def pending(self, job=None):
        return self._rows("status='intent'", job)

    def running(self, job=None):
        return self._rows("status='running'", job)

    def refires(self, job, chunk, stage):
        if chunk:
            return self.attempts(job, chunk)
        r = self.db.execute("SELECT MAX(refire) FROM fires WHERE job=? AND chunk='' AND stage=?", (job, stage)).fetchone()
        return r[0] or 0

    def resume(self, job):
        last = self.db.execute("SELECT * FROM fires WHERE job=? ORDER BY id DESC LIMIT 1", (job,)).fetchone()
        return {"pending": self.pending(job), "running": self.running(job),
                "last": dict(last) if last else None, "state": self.get_all(job)}

    def foreign(self, engine_run_ids):
        ids = list(engine_run_ids)
        if not ids:
            return []
        q = ",".join("?" * len(ids))
        known = {r[0] for r in self.db.execute(f"SELECT run_id FROM fires WHERE run_id IN ({q})", ids)}
        return [i for i in ids if i not in known]

    def set(self, job, k, v):
        self.db.execute("INSERT INTO kv VALUES(?,?,?) ON CONFLICT(job,k) DO UPDATE SET v=excluded.v", (job, k, str(v)))
        if k == "state":
            self.db.execute("INSERT INTO moves VALUES(?,?,NULL,?) ON CONFLICT(job) DO UPDATE SET prev=moves.state, "
                            "state=excluded.state, at=excluded.at WHERE moves.state != excluded.state", (job, str(v), now()))

    def moved(self, job):
        r = self.db.execute("SELECT state, prev, at FROM moves WHERE job=?", (job,)).fetchone()
        return dict(r) if r else None

    def forget(self, job):
        self.db.execute("DELETE FROM kv WHERE job=?", (job,))
        self.db.execute("DELETE FROM moves WHERE job=?", (job,))

    def get_all(self, job):
        return {r["k"]: r["v"] for r in self.db.execute("SELECT k,v FROM kv WHERE job=?", (job,))}

    def enqueue(self, job, stage, chunk="", payload=None, not_before=None, at=None):
        payload = payload or {"job": job, "stage": stage, "chunk": chunk}
        cur = self.db.execute("INSERT INTO queue(job,stage,chunk,payload,enqueued_at,not_before) VALUES(?,?,?,?,?,?)",
                              (job, stage, chunk, json.dumps(payload), at or now(), not_before))
        return cur.lastrowid

    def queued(self, at=None):
        rows = []
        for r in self.db.execute("SELECT * FROM queue ORDER BY id"):
            r = dict(r)
            if at is not None and r["not_before"] and r["not_before"] > at:
                continue
            r["payload"] = json.loads(r["payload"])
            rows.append(r)
        return rows

    def dequeue(self, queue_id):
        self.db.execute("DELETE FROM queue WHERE id=?", (queue_id,))

    def fire_count(self, job):
        return self.db.execute("SELECT COUNT(*) FROM fires WHERE job=?", (job,)).fetchone()[0]

    def known_run_ids(self):
        return {r[0] for r in self.db.execute("SELECT run_id FROM fires WHERE run_id IS NOT NULL")}

    def dequeue_to_intent(self, queue_id, job, chunk, stage, coworker="", slug="", lease_paths=None, lease_expires=None):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            fid = self.intent(job, chunk, stage, coworker, slug)
            self.dequeue(queue_id)
            if lease_paths is not None:
                self.grant_lease(job, chunk, lease_paths, lease_expires, attempt=self.attempts(job, chunk))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        return fid

    def add_ready(self, job, chunk, paths=(), builder="", deps=(), at=None):
        self.db.execute("INSERT INTO ready_chunks(job,chunk,builder,paths,deps,added_at) VALUES(?,?,?,?,?,?) "
                        "ON CONFLICT(job,chunk) DO UPDATE SET builder=excluded.builder, paths=excluded.paths, "
                        "deps=excluded.deps, state='ready' WHERE state='seen'",
                        (job, chunk, builder, json.dumps(list(paths)), json.dumps(list(deps)), at or now()))

    def _ready(self, r):
        r = dict(r)
        r["paths"], r["deps"] = json.loads(r["paths"]), json.loads(r["deps"])
        return r

    def get_ready(self, job, chunk):
        r = self.db.execute("SELECT * FROM ready_chunks WHERE job=? AND chunk=?", (job, chunk)).fetchone()
        return self._ready(r) if r else None

    def ready_list(self, job=None):
        sql = "SELECT * FROM ready_chunks WHERE state='ready'" + (" AND job=?" if job is not None else "") + " ORDER BY rowid"
        return [self._ready(r) for r in self.db.execute(sql, (job,) if job is not None else ())]

    def set_ready_state(self, job, chunk, state):
        self.db.execute("UPDATE ready_chunks SET state=? WHERE job=? AND chunk=?", (state, job, chunk))

    def attempts(self, job, chunk):
        r = self.db.execute("SELECT attempts FROM ready_chunks WHERE job=? AND chunk=?", (job, chunk)).fetchone()
        return r[0] if r else 0

    def _seen(self, job, chunk):
        self.db.execute("INSERT OR IGNORE INTO ready_chunks(job,chunk,state,added_at) VALUES(?,?,'seen',?)", (job, chunk, now()))

    def bump_attempt(self, job, chunk):
        self._seen(job, chunk)
        self.db.execute("UPDATE ready_chunks SET attempts=attempts+1 WHERE job=? AND chunk=?", (job, chunk))
        return self.attempts(job, chunk)

    def grant_lease(self, job, chunk, paths, expires_at, attempt=0, at=None):
        cur = self.db.execute("INSERT INTO leases(job,chunk,attempt,paths,granted_at,expires_at) VALUES(?,?,?,?,?,?)",
                              (job, chunk, attempt, json.dumps(list(paths)), at or now(), expires_at))
        return cur.lastrowid

    def _lease(self, r):
        r = dict(r)
        r["paths"] = json.loads(r["paths"])
        return r

    def get_lease(self, lease_id):
        r = self.db.execute("SELECT * FROM leases WHERE id=?", (lease_id,)).fetchone()
        return self._lease(r) if r else None

    def open_leases(self):
        return [self._lease(r) for r in self.db.execute("SELECT * FROM leases WHERE closed_at IS NULL ORDER BY id")]

    def close_lease(self, lease_id, reason, at=None):
        self.db.execute("UPDATE leases SET closed_at=?, reason=? WHERE id=? AND closed_at IS NULL",
                        (at or now(), reason, lease_id))

    def expire_leases(self, at):
        held = {(r["job"], r["chunk"]) for r in self.pending()}
        out = [l for l in self.open_leases() if l["expires_at"] < at and (l["job"], l["chunk"]) not in held]
        for l in out:
            self.close_lease(l["id"], "expired", at=at)
        return out

    def add_wake(self, event, coworker, head, at=None):
        cur = self.db.execute("INSERT OR IGNORE INTO wakes(event,coworker,head,at) VALUES(?,?,?,?)",
                              (event, coworker, head, at or now()))
        return cur.rowcount == 1

    def release_wake(self, event, coworker, head):
        return self.db.execute("DELETE FROM wakes WHERE event=? AND coworker=? AND head=?",
                               (event, coworker, head)).rowcount == 1

    def _write_job(self, job, state, data, reason, run_id, at):
        if state not in JOB_STATES:
            raise ValueError(f"unknown job state: {state!r}")
        data = dict(data or {})
        old = self.db.execute("SELECT state FROM jobs WHERE job=?", (job,)).fetchone()
        at = at or now()
        self.db.execute(
            "INSERT INTO jobs(job,state,pr,head,round,data,updated_at) VALUES(?,?,?,?,?,?,?) "
            "ON CONFLICT(job) DO UPDATE SET state=excluded.state, pr=excluded.pr, head=excluded.head, "
            "round=excluded.round, data=excluded.data, updated_at=excluded.updated_at",
            (job, state, data.get("pr"), data.get("head"), data.get("round"), json.dumps(data), at))
        self.db.execute("INSERT INTO transitions(job,at,from_state,to_state,reason,round,run_id) VALUES(?,?,?,?,?,?,?)",
                        (job, at, old[0] if old else None, state, reason, data.get("round"), run_id))

    def put_job(self, job, state, data, reason=None, run_id=None, at=None, reset_retries=False):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self._write_job(job, state, data, reason, run_id, at)
            if reset_retries:
                self.db.execute("DELETE FROM kv WHERE job=? AND k LIKE 'retry:%'", (job,))
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    @staticmethod
    def _job(r):
        d = json.loads(r["data"])
        d.update(state=r["state"], pr=r["pr"], head=r["head"], round=r["round"], updated_at=r["updated_at"])
        return d

    def get_job(self, job):
        r = self.db.execute("SELECT * FROM jobs WHERE job=?", (job,)).fetchone()
        return self._job(r) if r else None

    def jobs(self):
        return [self._job(r) for r in self.db.execute("SELECT * FROM jobs ORDER BY CAST(job AS INTEGER), job")]

    def transitions_of(self, job):
        return [dict(r) for r in self.db.execute("SELECT * FROM transitions WHERE job=? ORDER BY id", (job,))]

    def add_event(self, key, old, new, at=None):
        with self.db:
            self.db.execute("INSERT INTO events(at, key, old, new) VALUES (?,?,?,?)",
                            (at or now(), key, json.dumps(old), json.dumps(new)))

    def events(self):
        rows = self.db.execute("SELECT at, key, old, new FROM events ORDER BY id").fetchall()
        return [{"at": r[0], "key": r[1], "from": json.loads(r[2]), "to": json.loads(r[3])} for r in rows]

    def add_failure(self, kind, job, station="", coworker="", model=None, tier=None, reason="", plan_run=None, brief=None, at=None, runs=None, cost=None):
        with self.db:
            cur = self.db.execute(
                "INSERT INTO failures(at, kind, job, station, coworker, model, tier, reason, plan_run, brief, runs, cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (at or now(), kind, str(job), station, coworker, model, tier, gist(reason, 300), plan_run, brief, runs, cost))
        return cur.lastrowid

    def failures(self, after=0):
        cur = self.db.execute("SELECT * FROM failures WHERE id>? ORDER BY id", (after,))
        names = [c[0] for c in cur.description]
        return [dict(zip(names, r)) for r in cur.fetchall()]

    def keep_brief(self, hash, state, text, at=None):
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO briefs(hash, state, text, at) VALUES (?,?,?,?)",
                            (hash, state, text, at or now()))

    def brief_text(self, hash):
        row = self.db.execute("SELECT hash, state, text FROM briefs WHERE hash=?", (hash,)).fetchone()
        return dict(row) if row else None

    def add_change(self, issue, group, kind, before, at=None):
        with self.db:
            cur = self.db.execute(
                "INSERT INTO changes(at, issue, grp, kind, before) VALUES (?,?,?,?,?)",
                (at or now(), issue, group, kind, before))
        return cur.lastrowid

    def set_change(self, change_id, **fields):
        bad = set(fields) - CHANGE_COLUMNS
        if bad:
            raise ValueError(f"unknown change column: {', '.join(sorted(bad))}")
        if not fields:
            return
        sets = ", ".join(f"{k}=?" for k in fields)
        with self.db:
            self.db.execute(f"UPDATE changes SET {sets} WHERE id=?", (*fields.values(), change_id))

    def changes(self):
        return [dict(r) for r in self.db.execute("SELECT * FROM changes ORDER BY id")]

    def steps_seen(self, fire_id, steps, at=None):
        self.db.execute("UPDATE fires SET steps=?, steps_at=? WHERE id=? AND steps IS NOT ?",
                        (steps, at or now(), fire_id, steps))
        r = self.db.execute("SELECT steps_at FROM fires WHERE id=?", (fire_id,)).fetchone()
        return r[0] if r else None

    def retries(self, job, cls):
        r = self.db.execute("SELECT v FROM kv WHERE job=? AND k=?", (job, "retry:" + cls)).fetchone()
        return int(r[0]) if r else 0

    def bump_retry(self, job, cls):
        n = self.retries(job, cls) + 1
        self.set(job, "retry:" + cls, n)
        return n

    def import_json(self, path):
        if self.db.execute("SELECT 1 FROM kv WHERE job='-' AND k='imported_json'").fetchone():
            return 0
        n = 0
        self.db.execute("BEGIN IMMEDIATE")
        try:
            try:
                with open(path) as fh:
                    entries = json.load(fh).get("jobs", {})
            except FileNotFoundError:
                entries = {}
            for key, job in entries.items():
                state = job.get("state")
                if state not in JOB_STATES:
                    raise ValueError(f"job {key}: unknown state {state!r}")
                if self.db.execute("SELECT 1 FROM jobs WHERE job=?", (str(key),)).fetchone():
                    continue
                self._write_job(str(key), state, job, "imported", None, None)
                n += 1
            self.set("-", "imported_json", now())
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        if os.path.exists(path):
            os.rename(path, path + ".imported")
        return n

    def _rows(self, where, job):
        sql = "SELECT * FROM fires WHERE " + where + (" AND job=?" if job is not None else "") + " ORDER BY id"
        return [dict(r) for r in self.db.execute(sql, (job,) if job is not None else ())]
