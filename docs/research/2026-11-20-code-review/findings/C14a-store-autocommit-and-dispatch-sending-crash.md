# `C14a`: Autocommit Multi-Write Crash Windows in `store.py`, `dispatch.py`, and `runner_loop.py` Strand Jobs in `sending` Forever or Duplicate GitHub Side Effects

- **Finding:** Because `Store` opens SQLite with `isolation_level=None` (`store.py:78`), multi-statement mutations outside `put_job`/`dequeue_to_intent` (`intent`, `set`, `forget`, `fire_batch`) and external-call sequences in `dispatch.send()` (`dispatch.py:1114-1138`) and `runner_loop.finish_build()` (`runner_loop.py:295-298`) are non-atomic — most critically, a crash or raised `Error` in `dispatch.send()` leaves `j["sending"] = step` and `j["run"] = None` with **no recovery path anywhere in `dispatch.py`**, permanently wedging the job and its coworker slot!

## Evidence

- `tools/factory/dispatch.py:1106,1114-1139`:
  ```python
        j.update(agent=agent, copy=copy, run=None, sending=step, state=state, not_before=None, lost_beats=0)
        ...
        j["fire_id"] = self.store.intent(str(j["issue"]), "", step, coworker=self.names.get(agent, agent), at=j["intent_at"],
                                         model=(j.get("run_model") or {}).get("model"), thinking=(j.get("run_model") or {}).get("thinkingLevel"))
        self.save(j, step)
        self.store.set(str(j["issue"]), "seen", "")
        ...
        try:
            r = self.account("send_message", args)
        except Error as e:
            if "invalid_goal" in str(e):
                self.store.abandon(j["fire_id"], str(e)[:200])
                return self.end(j, "failed", str(e)[:200])
            self.save(j, "send of '%s' raised" % step)
            log(j["issue"], "send of '%s' raised: %s" % (step, e))
            return
        self.store.fired(j["fire_id"], r["runId"])
        j.update(run=r["runId"], sending=None)
        j.pop("handover", None)
        self.save(j, "sent " + step)
  ```
- Trace what happens on the next beat when `j["state"] == "building"` and `j["sending"] == "build"` (`j["run"] is None`) in `dispatch.py:1151-1153` and `2113-2120`:
  ```python
    def finished_run(self, j):
        r = self.account("get_run", {"agentId": j["agent"], "runId": j["run"]})
  ```
- `tools/factory/runner_loop.py:296-298` & `475-490`:
  ```python
            PB.publish(head, job, kv["title"], kv["base_branch"], lambda t, h, b, _="": self.open_pr(t, h, b, text), paths)
            self.st.set(job, "published:" + chunk, "1")
  ```
  ```python
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
  ```
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_store test_dispatch_crash test_runner_loop"`
  ```text
  OK (passed inside the 314-test Tier 3 batch)
  ```

## Trigger

1. **Crash or transient `Error` during `dispatch.send()` orphans live engine runs and fails the job (`dispatch.py:1114-1138` -> `1151-1153` -> `2119-2120`):**
   - `dispatch.send()` writes `j["state"] = "building"`, `j["run"] = None`, `j["sending"] = "build"`, and `j["fire_id"] = intent(...)`, then calls `self.account("send_message", args)`.
   - Suppose the dispatcher container restarts (`SIGKILL` / `update.sh`), or `send_message` times out / raises `Error` **after** the engine already started the coworker run (or before it reached the engine).
   - Unlike `planning.py:1368` (`self.adopt(...)`) and `runner_loop.py:182` (`resolve_pending()`), **`dispatch.py` has zero adoption/recovery handler for `j.get("sending")` / `j["run"] is None`!**
   - Instead, on each of the next 20 beats, `step(j)` calls `finished_run(j)` -> `account("get_run", {"agentId": agent, "runId": None})`, which fails with HTTP 400/404 (`Error`), incrementing `j["errors"]` until `FAIL_AFTER_S` expires (`line 2119`), then **terminates the job as `"failed"`** while leaving `fires[fire_id]` stuck in `status='intent'` forever and leaving any actually-started engine run running uncancelled in the background!
2. **`runner_loop.fire_batch()` non-atomic multi-chunk state (`runner_loop.py:475-490`):**
   - `fire_batch` commits `dequeue_to_intent` for `batch[0]`, then loops `grant_lease` + `intent` for `batch[1:]`, then loops `set_ready_state(job, c, "running")`, *then* calls `T.fire`, *then* loops `st.fired(f, run_id)`.
   - A crash after `dequeue_to_intent` (`line 475`) and before `set_ready_state` (`line 482`) leaves `batch[0]` with an open lease and `status='intent'` while `ready_chunks` is still `state='ready'`; if `T.fire` never happened, `resolve_pending` abandons `fid`, `sweep_leases` waits `2 * run_limit_s`, and `batch[1:]` never even got intents; if `crash` happens at `line 489` after `T.fire` succeeded and `fids[0]` was marked `fired(fids[0], run_id)`, `resolve_pending` sees `run_id` is now in `known_run_ids()` (`line 193-194`!) and **abandons `fids[1:]` as `FAILED`** even though the single batch run is actively building them!
3. **`store.py` multi-statement methods without `BEGIN IMMEDIATE` (`store.py:106-114,161-165,171-173`):** `intent()` runs `INSERT INTO fires`, `INSERT OR IGNORE INTO ready_chunks`, and `UPDATE ready_chunks`; `set(job, "state", v)` updates `kv` then `moves`; `forget(job)` deletes `kv` then `moves`. A crash between the two statements in `set` or `forget` desynchronizes `kv` from `moves` (also see `E20`).

## Impact and severity

- **Severity:** `high`
- **Impact:** A container restart or HTTP timeout during `dispatch.send()` orphans the in-flight Opus/Sonnet engine run, leaks an `intent` row in `fires`, and burns 20 error beats before killing the job as `"failed"`; a crash in `runner_loop.fire_batch` (`line 488-489`) causes `resolve_pending` to falsely abandon sibling chunk rows of the same batch run.

## Proposed fix

- **Smallest causal change (`tools/factory/store.py`, `tools/factory/dispatch.py`, `tools/factory/runner_loop.py`):**
  1. Wrap `Store.intent`, `Store.set`, and `Store.forget` (`tools/factory/store.py:106,161,171`) in `with self.db:` (`BEGIN IMMEDIATE` ... `COMMIT`) when not already inside a transaction (`if not self.db.in_transaction:`).
  2. Add `recover_sending(j)` at the top of `Dispatcher.finished_run(j)` (`tools/factory/dispatch.py:1151`): when `j.get("run") is None` and `j.get("sending")`: list recent runs of `j["agent"]` not in `store.known_run_ids()` started `>= j["intent_at"]` (matching `planning.adopt`), adopt + call `store.fired(j["fire_id"], rid)` if found, or else `store.abandon(j["fire_id"], ...)` and call `self.transient(j, "send interrupted before run id")` so the job cleanly retries its wait state instead of crashing 20 times!
  3. In `runner_loop.fire_batch` (`tools/factory/runner_loop.py:475-490`), wrap all pre-fire DB writes (`grant_lease`, `intent`, `set_ready_state`) in one `BEGIN IMMEDIATE` transaction and all post-fire `fired(f, run_id)` updates in one `BEGIN IMMEDIATE` transaction.
- **Must not break:** `dequeue_to_intent` (`store.py:204`, which already opens `BEGIN IMMEDIATE` and calls `self.intent()` — check `self.db.in_transaction` so nested calls don't raise `OperationalError: cannot start a transaction within a transaction`).
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_dispatch_crash.py`
  - **Test name:** `test_recovers_or_requeues_job_left_in_sending_without_run_id_after_crash`
  - **Assertion:** Persist a job with `state="building"`, `sending="build"`, `run=None`, `fire_id=fid`, `intent_at=ts`. Case A (`list_runs` has an unclaimed run started at `ts`): assert next `once()` adopts `runId` and marks `fid` `"running"`. Case B (`list_runs` is empty): assert next `once()` abandons `fid` and returns job to `"queued"` without incrementing `j["errors"]`.
- **Alternative fix and trade-off:** Pass an explicit client-generated `idempotencyKey = f"fire-{fire_id}"` on engine `POST /agents/:id/chat` (`send_message`), so retrying after a timeout/crash deterministically returns the exact same `runId` without timestamp-based `list_runs` heuristics.

## Confidence

`proven`
