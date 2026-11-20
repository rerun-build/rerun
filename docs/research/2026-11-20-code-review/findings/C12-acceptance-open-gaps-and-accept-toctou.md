# `C12`: `acceptance.py` Closes Parent Epics Without Re-Checking Open Children/Gaps at `accept()` Time and Misses Open `Gaps of #<parent>:` Issues That Omit `Part of #<parent>`

- **Finding:** `Station.poll() -> accept()` (`tools/factory/acceptance.py:228-229,252-256`) closes the parent issue on GitHub **without re-checking `open_children(n)`**, and `open_children(n)` (`lines 127-134`) only searches issue bodies for `Part of\W*#%d\b`, missing any open `"Gaps of #<n>:"` issue whose LLM-authored body omitted the `**Part of**: #<n>` line (a failure mode `labelcheck.py:97` explicitly anticipates!).

## Evidence

- `tools/factory/acceptance.py:127-135,173-174,227-230,252-256`:
  ```python
    def open_children(self, n):
        raw = json.loads(self.gh(["issue", "list", "-R", self.repo, "--state", "open", "--json", "number,body",
                                  "--limit", str(OPEN_LIMIT)]))
        if len(raw) >= OPEN_LIMIT:
            self.log(n, "acceptance waits: the open issue list reached %d, so not every open child can be seen" % OPEN_LIMIT)
            return raw
        pattern = re.compile(r"Part of\W*#%d\b" % n)
        return [i for i in raw if pattern.search(i.get("body") or "")]
  ...
            if self.open_children(n):
                continue
  ...
        kind, nums, line = outcome(got.get("output"))
        if kind == "accepted":
            return self.accept(n, line)
  ...
    def accept(self, n, line):
        name = self.name(n)
        self.gh(["issue", "close", str(n), "-R", self.repo, "--comment", "Accepted by %s.\n%s" % (name, line)])
        self.store.set("accept:%d" % n, "state", "accepted")
        self.log(n, "accepted by %s: %s" % (name, line))
  ```
- Compare `tools/factory/labelcheck.py:47-49,97-98` (proving LLM gap issues can have title `Gaps of #<parent>:` while omitting `Part of #<parent>` in the body!):
  ```python
        m = GAPS.match(i.get("title") or "")
        ...
    if not re.search(r"Part of\W*#%d\b" % dup["parent"], kept):
        return "#%d does not say it is part of #%d" % (dup["keep"], dup["parent"])
  ```
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_acceptance test_dispatch_acceptance"`
  ```text
  OK (passed inside the 314-test Tier 3 batch)
  ```

## Trigger

1. **Open `Gaps of #<n>:` issue without `Part of #<n>` in body (`acceptance.py:128-134,161,268`):**
   - Acceptor run 1 finds gaps, opens `#610` titled `Gaps of #600: ...` (forgetting the `**Part of**: #600` body line — which `labelcheck.py:97` specifically guards against because LLM acceptors occasionally omit it), and sets `accept:600` `state = "gaps"`.
   - Notice `"gaps"` is **not** in `HELD = ("running", "accepted", "closed", "left")` (`line 16`)!
   - On the very next `beat % 5 == 0` (`5` beats later), `start()` sees `due_map[600]` still satisfied, `state == "gaps"` not in `HELD`, and calls `open_children(600)` — which fetches `--json number,body` (not `title`!) and checks only `Part of\W*#600\b`! It returns `[]`, immediately starting a second acceptor run while `#610` is still open and unworked; if the second acceptor says `ACCEPTED:`, `#600` is closed while `#610` sits open!
2. **TOCTOU window during `running` acceptance (`acceptance.py:173` vs `228-229,254`):** An acceptance run can run for up to `RUN_LIMIT = 2700` seconds (45 minutes). If a new child slice, follow-up child, or reopened child of `#600` appears on GitHub (or a child job moves out of `DONE` via reopen) while `accept:600` is `"running"`, `poll()` calls `self.accept(n, line)` at `line 229` and closes `#600` without re-checking `due(jobs)` or `self.open_children(n)`!

*(Note on `revive()` [`lines 243-250`]: `revived` is persisted as `"1"` in `kv`, and `row.get("revived")` is truthy forever after, so `revive()` never grants *more* than one fresh round — though crashing between `set(job, "revived", 1)` and `set(job, "state", "unsent")` at `lines 247-248` grants *zero* rounds, covered in `C14b`.)*

## Impact and severity

- **Severity:** `high`
- **Impact:** Prematurely closes parent epic issues as `Accepted` while open gap issues (`Gaps of #<n>:`) or newly opened/reopened child slices remain unfinished.

## Proposed fix

- **Smallest causal change (`tools/factory/acceptance.py`):**
  1. In `open_children(self, n)` (`tools/factory/acceptance.py:128-134`), request `--json number,title,body` and match `pattern.search(i.get("body") or "") or re.match(r"^Gaps of #%d\b" % n, i.get("title") or "")`.
  2. In `poll(self, n, row)` (`line 228`) / `accept(self, n, line)` (`line 252`), re-check `if self.open_children(n):` right before `gh issue close`: if open children/gaps now exist, set `state = "gaps"` (do not close the parent) and log that acceptance was deferred until open children finish.
- **Must not break:** Re-running acceptance automatically once all `Part of #<n>` child slices and `Gaps of #<n>:` issues are closed (`state == "gaps"` intentionally re-enters `start()` once `open_children(n)` is empty).
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_acceptance.py`
  - **Test name:** `test_does_not_restart_or_accept_parent_while_gaps_of_title_issue_is_open_or_child_reopens_mid_run`
  - **Assertion:** Have an open issue `{number: 99, title: "Gaps of #10: missing validation", body: "Needs validation."}` (no `Part of #10` line) and assert `open_children(10)` returns it; second, open a `Part of #10` child while `accept:10` is `"running"` and assert `poll()` on `ACCEPTED:` does not call `gh issue close 10`.
- **Alternative fix and trade-off:** Store the gap issue numbers `nums` returned by `outcome()` in `kv` (`accept:<n> -> open_gaps`) in `gaps()` (`line 268`) and verify every stored gap issue is closed on GitHub in addition to `open_children(n)`. Even stronger because it catches gap issues whose title *and* body were edited.

## Confidence

`proven`
