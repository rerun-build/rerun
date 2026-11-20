# `C10`: `dispatch.checks()` Marks Unreviewed External Merges as `own_merge=True` on Head-Mismatch Race, Exposes `/data/tools/bin/merge-dev` to Coworker Shells, and Merges Multiple PRs Within One Beat Before `dev_hold` Updates

- **Finding:** When `gh pr merge --match-head-commit j["head"]` fails in `dispatch.checks()` because another actor pushed and merged a *different* commit, the `except Error` branch (`dispatch.py:1781-1788`) checks only `state == "MERGED"` without verifying `headRefOid == j["head"]`, marking an unreviewed merge as `j["own_merge"] = True`; additionally, `/data/tools/bin/merge-dev` (`factory.py:1023-1055`) is installed into `/data/tools/bin` on coworker containers and merges PRs to `dev` without checking dispatcher review/proof state!

## Evidence

- `tools/factory/dispatch.py:1778-1791`:
  ```python
        j.pop("dev_hold", None)
        try:
            self.gh(["pr", "merge", str(j["pr"]), "-R", self.repo, "--merge", "--match-head-commit", j["head"], "--delete-branch"])
        except Error:
            if json.loads(self.gh(["pr", "view", str(j["pr"]), "-R", self.repo, "--json", "state"])).get("state") != "MERGED":
                tries = j.get("merge_refused", 0) + 1
                if tries < MERGE_TRIES:
                    j["merge_refused"] = tries
                    return self.save(j, "merge of #%s at %s refused (%d of %d), tried again next beat" % (j["pr"], j["head"][:7], tries, MERGE_TRIES))
                return self.end(j, "failed", "merge of #%s at %s refused %d times" % (j["pr"], j["head"][:7], tries))
        j["own_merge"] = True
        self.close_earlier(j)
        self.end(j, "merged", "#%s at %s" % (j["pr"], j["head"][:7]))
  ```
- `tools/factory/factory.py:1044-1055` & `tools/factory/bin/merge-dev:1-3`:
  ```python
    cs = checks(full, pr["head"]["sha"])
    s = ci_state(cs)
    if s != "GREEN":
        die("CI is %s on %s, not GREEN. Reviewers never wait on CI: return BLOCKED to @boss.\n%s" % (s, pr["head"]["sha"][:8], ci_table(cs)))
    g = run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "gate.py"), full, n], check=False)
    if g.returncode:
        die("gate did not pass at %s (exit %s), not merging.\n%s" % (pr["head"]["sha"][:8], g.returncode, (g.stdout or g.stderr).strip()[-600:]), 1)
    ...
    r = run([GH, "pr", "merge", n, "-R", full, "--merge", "--match-head-commit", pr["head"]["sha"]], check=False)
  ```
- `tools/factory/dispatch.py:2083,2098-2102,2139`:
  ```python
            self.dev_results()
        ...
        for j in self.jobs():
            try:
                if j["state"] not in END:
                    self.step(j)
        ...
            self.resolver.beat(self, heard, self.beat_line)
  ```
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_dispatch test_merge_dev_gate test_dispatch_proven test_dispatch_proven_guards"`
  ```text
  OK (passed inside the 314-test Tier 3 batch)
  ```

## Trigger

1. **Coworker-accessible `merge-dev` CLI (`tools/factory/bin/merge-dev`, `factory.py:1023-1055`, `tools/factory/bin/gh`):** Every coworker container mounts `/data/tools/bin` (`docker-compose.vps.yml:45`) and `/run/factory-token` + `/data/tools/github/token`. Any builder, reviewer, prover, or prompt-injected coworker (`A1b`/`C15`) can invoke `/data/tools/bin/merge-dev moldwright <pr>` (or `gh pr merge` directly via `/data/tools/bin/gh`!) to merge an unreviewed PR into `dev` as soon as CI + `gate.py` are green, completely bypassing dispatcher review and proof!
2. **Unreviewed head misattributed as `own_merge` (`dispatch.py:1780-1790`):** If `gh pr merge --match-head-commit j["head"]` raises `Error` because a new commit `H2 != j["head"]` was pushed and merged externally between `now_head` (`line 1727`) and `line 1780`, `pr view --json state` returns `"MERGED"` even though `headRefOid` is `H2`, so `dispatch.py:1788` stamps `j["own_merge"] = True` and logs `"merged: #%s at %s" % (j["pr"], j["head"][:7])` for a commit it never reviewed or merged.
3. **One-beat `dev_hold` lag & multi-PR merge burst (`dispatch.py:2083,2098-2102,2139`):** In `once()`, `dev_results()` runs at `line 2083`, `for j in self.jobs(): self.step(j)` runs at `lines 2098-2101`, and `self.resolver.beat(...)` (which populates `resolver.records["dev red"]` read by `dev_hold()`!) runs *after* `self.step(j)` at `line 2139`! Thus:
   - On the beat where `dev_results()` first marks `dev_result = "red"` (`line 2083`), `resolver.records` does **not yet contain `"dev red"`** during `self.step(j)` (`line 2101`), allowing every ready PR in that beat to merge onto an already-proven-red `dev`!
   - Even before `dev`'s CI finishes (~5–15 min), `checks()` merges **all** ready PRs in `self.jobs()` in a single beat without waiting for the previous merge's `dev` CI run (`merge_sha` has `WAIT` status, not `red`).

## Impact and severity

- **Severity:** `high`
- **Impact:** Coworkers can bypass review/proof via `merge-dev` / `gh pr merge`, `dev_results()` discovering `dev` is red still allows one full beat of ready PRs to merge before `resolver.beat()` sets `"dev red"`, and external head-mismatched merges are recorded as `own_merge=True`.

## Proposed fix

- **Smallest causal change (`tools/factory/dispatch.py`, `tools/factory/bin/gh`):**
  1. In `dispatch.once()` (`tools/factory/dispatch.py:2083`), update `dev_hold(j)` (`line 1804`) to also block merges immediately if *any* job's latest `dev_result == "red"` (matching `problems.Watch.find` `lines 23-25`), even before `resolver.beat()` creates the `"dev red"` record at the end of the beat — and allow at most **one** `gh pr merge` per beat (or while another `own_merge` job has `dev_result is None`) if serial `dev` verification is desired.
  2. In `dispatch.checks()` (`tools/factory/dispatch.py:1782`), fetch `--json state,headRefOid` and treat `state == "MERGED"` with `headRefOid != j["head"]` as `"merged outside the delegator"` (`own_merge = False`), matching `stop_lost()` (`line 1007`).
  3. Block `pr merge` and `api ... /pulls/.../merge` inside `tools/factory/bin/gh` unless `FACTORY_DISPATCHER=1` (set only in the `factory-dispatcher` container, never in `engine`), and remove `merge-dev` from coworker-visible `/data/tools/bin`.
- **Must not break:** Idempotent recovery in `dispatch.checks()` when `gh pr merge` succeeded on GitHub for `headRefOid == j["head"]` before timing out locally (`test_dispatch.py:599`).
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_merge_dev_gate.py`
  - **Test name:** `test_holds_merge_on_same_beat_dev_turns_red_and_rejects_mismatched_merged_head`
  - **Assertion:** Have merged job `#1` turn `dev_result="red"` during `dev_results()` in the same `once()` beat where job `#2` is green in `checks`; assert job `#2` does **not** call `gh pr merge` on that beat; and when `gh pr merge` raises `Error` and `pr view` returns `{"state": "MERGED", "headRefOid": OTHER_HEAD}`, assert `j.get("own_merge")` is falsy.
- **Alternative fix and trade-off:** Enable a GitHub repository ruleset on `dev` requiring a signed status check or review from a dedicated dispatcher-only GitHub App (separate from the coworker `GH_TOKEN`). Enforces merge exclusivity on GitHub's server rather than wrapper scripts.

## Confidence

`proven`
