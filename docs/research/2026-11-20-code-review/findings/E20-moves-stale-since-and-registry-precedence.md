# `E20`: `moves.at` Stays Stale Across Same-State Retries (Causing False `stuck()` Alarms), `import_json` Never Populates `moves`, and Ended `job` Rows Shadow `accept:gaps` / `accept:accepted` in `registry.ORDER`

- **Finding:** `Store.set()` updates `moves.at` only `WHERE moves.state != excluded.state` (`store.py:165`), so when a station re-enters or re-sends in the same state (`kv_row` at `registry.py:120` reads `stamp.get("at") or iso(rec.get("started"))`), the stale `moves.at` overrides the newer `rec["started"]` and triggers false `stuck()` alarms; `Store.import_json()` (`store.py:393-419`) never populates `moves`; and `ORDER` (`registry.py:126-127`) ranks `("job", False)` ahead of `("accept", False)` (while `LIVE_KV["accept"]` marks `"gaps"` and `"left"` as `live=True`, shadowing new `plan` / `instr` / `classify` rows!).

## Evidence

- `tools/factory/store.py:161-166`:
  ```python
    def set(self, job, k, v):
        self.db.execute("INSERT INTO kv VALUES(?,?,?) ON CONFLICT(job,k) DO UPDATE SET v=excluded.v", (job, k, str(v)))
        if k == "state":
            self.db.execute("INSERT INTO moves VALUES(?,?,NULL,?) ON CONFLICT(job) DO UPDATE SET prev=moves.state, "
                            "state=excluded.state, at=excluded.at WHERE moves.state != excluded.state", (job, str(v), now()))
  ```
- `tools/factory/registry.py:40-41,118-127,158-160`:
  ```python
  LIVE_KV = {"plan": set(STEPS["plan"]) - {"cut", "blocked", "lost"}, "recheck": {"sending", "running"},
             "accept": set(STEPS["accept"]) - {"accepted", "closed"}, "instr": {"review", "unsent"}}
  ...
    if status:
        hand = {"status": status, "from": (stamp or {}).get("prev"), "to": state,
                "since": (stamp or {}).get("at") or iso(rec.get("started")), "why": rec.get("why") or None,
                "by": rec.get("name") or rec.get("agent")}
  ...
  ORDER = (("recheck", True), ("job", True), ("accept", True), ("plan", True), ("instr", True), ("classify", True),
           ("job", False), ("accept", False), ("plan", False), ("instr", False), ("recheck", False))
  ```
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_registry test_storeread"`
  ```text
  OK (passed inside Tier 4 unittest batch)
  ```

## Trigger

1. **Stale `moves.at` overrides fresh `rec["started"]` -> false `stuck()` alarms (`store.py:165` + `registry.py:120,159` + `planning.py:1308`):**
   - Look at `planning.replan()` (`planning.py:1348 -> 1387`): if a job was already in `"sending"` (or if `planning.send()` adopts an existing run at `line 1377` setting `state = "planning"` when `moves.state` was already `"planning"`), `moves.state != excluded.state` is `False`, so `moves.at` keeps its **old** timestamp from hours ago while `rec["started"]` holds the brand-new run timestamp!
   - Because `kv_row` (`registry.py:120`) evaluates `(stamp or {}).get("at") or iso(rec.get("started"))`, `since` gets the old `moves.at`, and `stuck()` (`line 158-159`) immediately flags the brand-new `"taken"` run as hung (`at - since > run_limit_s`)!
2. **`ORDER` precedence invert between `("job", False)` and `("accept", False)`, and `"gaps"` in `LIVE_KV["accept"]` (`registry.py:41,126-127`):**
   - When an epic `#100` was previously rejected/returned as a direct job (`jobs["100"].state == "returned"`, `live=False`), later cut into children, and finally accepted (`kv["accept:100"].state == "accepted"`, `live=False`), `ORDER` puts `("job", False)` **before** `("accept", False)` — so the dashboard/digest reports `#100` in step `"problem"` (`returned`) even though it is `"done"` (`accepted`)!
   - Conversely, while `accept:100` is in `"gaps"` (`LIVE_KV["accept"]` treats `"gaps"` as `live=True`!), if `#100` is re-planned (`plan:100` in `"planning"`, `live=True`), `("accept", True)` beats `("plan", True)` in `ORDER`, hiding the active planner run behind the idle `"gaps"` state!
3. **`Store.import_json` (`store.py:393-419`) omits `moves`:** Importing a JSON snapshot populates `jobs`, `transitions`, `fires`, and `kv` directly via `INSERT INTO kv` (bypassing `self.set`), leaving `moves` completely empty so non-running states (`planned`, `revise`, `gaps`, `left`) have `since = iso(rec.get("started"))` (the start of an *earlier* finished run rather than when the state was entered).

## Impact and severity

- **Severity:** `low`
- **Impact:** Misleading `"stuck"` alerts and wrong step counts/labels in factory status snapshots and digests (`registry.summary`), though `dispatch.py` state transitions themselves read `jobs`/`kv` rather than `registry.rows`.

## Proposed fix

- **Smallest causal change (`tools/factory/registry.py`, `tools/factory/store.py`):**
  1. In `kv_row` (`tools/factory/registry.py:120`), when `status == "taken"` and `rec.get("started")` is newer than `(stamp or {}).get("at")`, prefer `max(filter(None, [(stamp or {}).get("at"), iso(rec.get("started"))]))` so a freshly started run is never dated back to an older `moves.at`.
  2. In `registry.py:41,126-127`, move `"gaps"` and `"left"` out of `LIVE_KV["accept"]` when no acceptor is running (or rank `("plan", True)` above idle `accept` states) and rank `("accept", False)` ahead of `("job", False)` when `rec.get("state") == "accepted"` so an accepted parent epic reports `"done"` instead of an older ended `"job"` row.
  3. Backfill `moves` inside `Store.import_json` (`tools/factory/store.py:415`) for imported `kv` `"state"` rows.
- **Must not break:** `test_registry.py` and `labelcheck.check()` (`parked_but_moving` at `labelcheck.py:27`, which checks `status == "taken"`, unaffected by `LIVE_KV["accept"]` for `"gaps"`/`"left"` whose statuses are `"back"`/`"refused"`).
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_registry.py`
  - **Test name:** `test_accepted_parent_wins_over_older_returned_job_and_fresh_started_beats_stale_move`
  - **Assertion:** Insert an ended `job` (`state="returned"`) and `accept:<n>` (`state="accepted"`) for issue `"10"` and assert `registry.rows` picks `step == "done"`; second, set `moves.at` 2 hours ago while `rec["started"]` is 10 seconds ago on `status="taken"` and assert `stuck()` is `False`.
- **Alternative fix and trade-off:** Update `moves.at = excluded.at` whenever `started` is written in `Store.set_many` (`C14b`), keeping `moves` authoritative in one place.

## Confidence

`proven`
