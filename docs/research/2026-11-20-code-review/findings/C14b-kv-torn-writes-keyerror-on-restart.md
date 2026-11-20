# `C14b`: Torn `kv` `store.set` Loops in `acceptance.py`, `planning.py`, and `labelcheck.py` Raise `KeyError` on Restart or Strand `revive`

- **Finding:** `acceptance.py` and `planning.py` persist multi-field station transitions by looping `for k, v in (...): self.store.set(job, k, v)` in autocommit mode with `("state", ...)` **first** (`acceptance.py:191`, `planning.py:728,1387`) — so a crash right after writing `"state"` leaves `"agent"`, `"copy"`, `"started"`, or `"fire"` missing from `kv`, causing `KeyError` crash loops on every subsequent beat; and `acceptance.revive()` (`acceptance.py:247-248`) writes `"revived"=1` *before* `"state"="unsent"`, permanently burning the single revival if interrupted between those two writes.

## Evidence

- `tools/factory/acceptance.py:121-125,191-193,209-214,243-250`:
  ```python
    def live(self):
        return {n: r for n, r in self.records().items() if r.get("state") == "running"}

    def running(self):
        return [(r["agent"], int(r["copy"])) for r in self.live().values()]
  ...
        for k, v in (("state", "running"), ("agent", agent), ("copy", copy), ("started", self.now()), ("run", ""),
                     ("fire", fire), ("sends", sends), ("name", name)):
            self.store.set(job, k, v)
  ...
    def poll(self, n, row):
        sends = int(row.get("sends", 0))
        if not row.get("run"):
            self.store.abandon(int(row["fire"]), "the send was cut off before a run id was kept")
  ...
    def revive(self, n, row):
        if row.get("revived") or (row.get("left_at") and self.now() - float(row["left_at"]) < REVIVE_S):
            return row
        job = "accept:%d" % n
        for k, v in (("revived", 1), ("sends", 0), ("state", "unsent")):
            self.store.set(job, k, v)
  ```
- `tools/factory/planning.py:497-499,728-730,748-752,1308-1309,1387-1391`:
  ```python
    def running(self):
        own = [(r["agent"], int(r["copy"])) for r in self.live().values()]
        return own + [(r["agent"], int(r["copy"])) for r in self.live_rechecks().values()]
  ...
        for name, value in (("state", "sending"), ("attempt", str(j.get("rechecks"))), ("agent", agent), ("copy", copy),
                            ("started", at), ("run", ""), ("fire", fire), ("head", head), ("why", "")):
            self.store.set(job, name, value)
  ...
        for k, v in (("state", "sending"), ("agent", agent), ("copy", copy), ("started", at),
                     ("title", item["title"]), ("run", ""), ("why", ""), ("intent", at), ("fire", fire), ...):
            self.store.set(job, k, v)
  ```
- `tools/factory/dispatch.py:2150`:
  ```python
            self.causes.once(self.beats, self.running() + [(r["agent"], int(r["copy"])) for r in self.station.live().values() if r.get("agent") and r.get("copy")])
  ```
  *(Note how `dispatch.py:2150` defensively checks `if r.get("agent") and r.get("copy")`, whereas `planning.py:498-499` and `acceptance.py:125,212` index `r["agent"]`, `int(r["copy"])`, and `int(row["fire"])` unconditionally!)*
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_planning_cut test_planning_start test_acceptance test_resolver"`
  ```text
  OK (passed inside the 314-test Tier 3 batch)
  ```

## Trigger

1. **Permanent `KeyError` bricking `acceptance` and `planning` stations on restart (`acceptance.py:191` -> `125,212`; `planning.py:728,1387` -> `498-499,751`):**
   - In `acceptance.send()` (`line 191`), `self.store.set(job, "state", "running")` autocommits to SQLite first. If `SIGKILL` / power loss hits before `("agent", ...)` or `("fire", ...)` is written:
     - On every beat after restart, `acceptance.poll()` (`line 212`: `int(row["fire"])`) and `acceptance.running()` (`line 125`: `r["agent"], int(r["copy"])`) raise `KeyError`, aborting `self.acceptance.once()` (`dispatch.py:2066`) for **all** parent epics in the repository!
   - Identically, in `planning.send()` (`line 1387`, `"sending"` is in `LIVE`!) and `planning.send_recheck()` (`line 728`, `"sending"` is in `live_rechecks()`!), `("state", "sending")` autocommits first. A crash before `("agent", ...)` / `("copy", ...)` causes `planning.running()` (`line 498-499`) and `poll_recheck()` (`line 751`: `row["agent"], row["started"]`) to raise `KeyError`, aborting `self.station.once()` (`dispatch.py:2052`) on every beat!
2. **`acceptance.revive()` loses its one revival on crash (`acceptance.py:247-248`):**
   - `revive()` writes `("revived", 1)` first, `("sends", 0)` second, and `("state", "unsent")` last. A crash after `("revived", 1)` leaves `state == "left"` with `revived == "1"`, so on restart `if row.get("revived"): return row` (`line 244`) skips revival forever — the parent gets **zero** fresh rounds.
3. **`planning.cut()` leaves old `"state"="planned"` with half-overwritten `agent`/`fire` (`planning.py:1307-1309`):** If a crash occurs after `intent` + `set(job, ...)` at `lines 1307-1309` before `send_message`, `state` stays `"planned"` while `fire` is stranded in `status='intent'` without ever being abandoned on the next `cut()` retry!

*(Note: `resolver.py` avoids torn fields because `self.put(d, key, r)` serializes the entire `r` dict into a single JSON `kv` value `store.set("resolver", key, json.dumps(r))`; and `planning.file_questions` [`lines 1004-1021`] saves `questions` after each created issue, limiting partial-crash blast radius to at most one unrecorded issue if killed between `gh issue create` at `line 1012` and `store.set` at `line 1021`.)*

## Impact and severity

- **Severity:** `high`
- **Impact:** A single untimely crash during `acceptance.send()`, `planning.send()`, or `planning.send_recheck()` bricks the entire `acceptance` or `planning` station across all issues with unhandled `KeyError` exceptions on every subsequent dispatcher beat until manual SQLite surgery.

## Proposed fix

- **Smallest causal change (`tools/factory/store.py`, `tools/factory/acceptance.py`, `tools/factory/planning.py`):**
  1. Add an atomic `set_many(self, job, items)` helper on `Store` (`tools/factory/store.py:161`):
     ```python
     def set_many(self, job, items):
         with self.db:
             for k, v in items:
                 self.set(job, k, v)
     ```
  2. Replace every `for k, v in (...): self.store.set(job, k, v)` multi-field update across `acceptance.py` (`lines 191-193, 239-240, 247-248`) and `planning.py` (`lines 603-604, 614-617, 625-628, 728-730, 925-928, 957-959, 995-998, 1148-1149, 1308-1309, 1331-1332, 1339-1341, 1375-1380, 1387-1391, 1418-1421, 1424-1425, 1433-1436`) with `self.store.set_many(job, [...])`, always placing `("state", ...)` last in the list as belt-and-suspenders.
- **Must not break:** `moves` table tracking when `"state"` is included in `set_many` (calling `self.set` inside `with self.db:` updates both `kv` and `moves` in the same SQLite transaction).
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_acceptance.py` (and `tools/factory/test_planning_start.py`)
  - **Test name:** `test_set_many_rolls_back_all_kv_fields_if_interrupted_mid_write`
  - **Assertion:** Simulate an exception after the first `INSERT INTO kv` inside `set_many("accept:10", [("state", "running"), ("agent", "a1"), ...])` (or verify `db.in_transaction` during `set_many`); assert `store.get_all("accept:10")` remains empty rather than leaving `{"state": "running"}` without `"agent"`/`"fire"`, and assert `acceptance.once` does not raise `KeyError`.
- **Alternative fix and trade-off:** Store each `accept:<n>` and `plan:<n>` record as a single JSON blob under one `kv` key (matching `resolver.py` and `jobs.data`). Eliminates multi-row `kv` tearing by schema design, at the cost of migrating existing `kv` readers in `snapshot.py` / `states.py`.

## Confidence

`proven`
