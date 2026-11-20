# `C13`: `dev_results()` Excludes `cancelled` / `startup_failure` Workflows From `failed`, Letting `dev_healed()` Clear `dev red` Without Re-Running Cancelled Workflows on `merge_sha`

- **Finding:** When a `dev` merge commit has one `failure` workflow and a second workflow that was `cancelled` or `action_required`, `checks_verdict` returns `"FAIL"` (`dispatch.py:509-511`) while `failed` (`line 1838`) records only `("failure", "timed_out")` workflow IDs — so a later docs/factory-only commit on `dev` whose path filter skips the cancelled workflow (`images.yml` `paths-ignore`) satisfies `failed <= passed` in `dev_healed()` without the cancelled workflow ever passing; additionally, `checks_verdict` treats `per_page=100` truncated `workflow_runs` as complete.

## Evidence

- `tools/factory/dispatch.py:509-517,1810-1824,1836-1844`:
  ```python
    bad = [r["name"] for r in runs if r.get("conclusion") in ("failure", "timed_out")]
    if bad:
        return "FAIL", "workflow run failed: " + ", ".join(bad)
    passed = {r.get("workflow_id") for r in runs if r.get("conclusion") == "success"}
    other = [r for r in runs if r.get("conclusion") not in OK_CONCLUSIONS
             and not (r.get("conclusion") == "cancelled" and r.get("workflow_id") in passed)]
    if other:
        return "WAIT", "not passed: " + ", ".join("%s %s" % (r["name"], r.get("conclusion")) for r in other)
    return "OK", None
  ...
    def dev_healed(self, sha, failed):
        ...
            runs = json.loads(self.gh(["api", "repos/%s/actions/runs?head_sha=%s&per_page=100" % (self.repo, head)])).get("workflow_runs") or []
        except (Error, ValueError, KeyError, TypeError, AttributeError):
            return None
        passed = {r.get("workflow_id") for r in runs if r.get("conclusion") == "success"}
        return head if checks_verdict(runs)[0] == "OK" and failed <= passed else None
  ...
            runs = json.loads(self.gh(["api", "repos/%s/actions/runs?head_sha=%s&per_page=100" % (self.repo, j["merge_sha"])])).get("workflow_runs") or []
            verdict, why = checks_verdict(runs)
            failed = {r.get("workflow_id") for r in runs if r.get("conclusion") in ("failure", "timed_out")}
            healed = self.dev_healed(j["merge_sha"], failed) if verdict == "FAIL" else None
  ```
- `.github/workflows/images.yml:4-6,13-15`:
  ```yaml
  on:
    push:
      branches: [dev]
      paths-ignore: ['docs/**', 'tools/factory/**', 'deploy/vps/**']
  ...
  concurrency:
    group: images-${{ github.ref }}
    cancel-in-progress: true
  ```
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright/tools/factory && python3 -m unittest test_dispatch_devresult test_problems"`
  ```text
  OK (passed inside the 314-test Tier 3 batch)
  ```

## Trigger

*(What holds for normal single-workflow failures: when `factory-tools.yml` [`paths: tools/factory/**`] or `images.yml` [`paths-ignore: docs/**, tools/factory/**, deploy/vps/**`] actually concludes `"failure"` on `merge_sha`, its `workflow_id` IS added to `failed`, and a later commit where that workflow is path-skipped creates **no** workflow run at all, so its `workflow_id` is absent from `passed` and `failed <= passed` correctly evaluates `False`.)*

However, look at what happens under `images.yml:15` (`cancel-in-progress: true`)!
1. PR `#1` (breaking `apps/ui/Dockerfile` *and* a flaky unit test in `ci.yml`) merges to `dev` as `sha_1`.
2. Immediately afterward (see `C10`), PR `#2` (touching `apps/engine/...`) merges as `sha_2`, **cancelling** `sha_1`'s in-progress `Images` workflow run (`cancel-in-progress: true` in `images.yml:15`)!
3. On `sha_1`, `CI` (`wid=10`) concludes `"failure"` and `Images` (`wid=20`) concludes `"cancelled"`. Assume `sha_2`'s `Images` run *also* fails (`Dockerfile` is broken on `dev`!), and then a factory hotfix PR `#3` touching only `tools/factory/...` merges as `sha_3`.
4. On `sha_3`, `CI` (`wid=10`) and `Factory tools` (`wid=30`) run and conclude `"success"`, while `Images` (`wid=20`) does **not** run because `tools/factory/**` is in `images.yml`'s `paths-ignore`!
5. Now `dev_results()` inspects `sha_1`: `failed` is `{10}` (because `wid=20` was `"cancelled"`, not `"failure"`!) -> `dev_healed(sha_1, {10})` sees `passed = {10, 30}` on `head = sha_3` -> `{10} <= {10, 30}` is **`True`**, marking `sha_1` `"green"`! Meanwhile, if PR `#2` wasn't `own_merge` (e.g. direct/manual push or `C10` head mismatch), `problems.Watch.find` sees latest `dev_result == "green"` and clears `"dev red"` while `Images` is still broken on `dev`!

## Impact and severity

- **Severity:** `medium`
- **Impact:** Any workflow on `merge_sha` whose run ended `"cancelled"`, `"startup_failure"`, or `"action_required"` alongside a `"failure"` workflow is omitted from `failed` (`dispatch.py:1838`), allowing `dev_healed()` to mark the merge commit healed on a later `head` that path-skipped that workflow.

## Proposed fix

- **Smallest causal change (`tools/factory/dispatch.py`):**
  In `dev_results()` (`tools/factory/dispatch.py:1838`), require `dev_healed` to see a `"success"` on `head` for **every** workflow ID on `merge_sha` that did not already conclude in `OK_CONCLUSIONS` (`{"success", "skipped", "neutral"}`):
  ```python
  passed_on_merge = {r.get("workflow_id") for r in runs if r.get("conclusion") in OK_CONCLUSIONS}
  unproven = {r.get("workflow_id") for r in runs if r.get("workflow_id") not in passed_on_merge}
  healed = self.dev_healed(j["merge_sha"], unproven) if verdict == "FAIL" else None
  ```
- **Must not break:** Normal `dev_healed` recovery when `CI` fails transiently on `merge_sha` and passes on a subsequent `dev` commit while `Images` already concluded `"success"` on `merge_sha` (`test_dispatch_devresult.py`).
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_dispatch_devresult.py`
  - **Test name:** `test_dev_healed_requires_cancelled_workflow_on_merge_sha_to_pass_on_head`
  - **Assertion:** On `merge_sha`, return `CI` (`workflow_id=1`, `conclusion="failure"`) and `Images` (`workflow_id=2`, `conclusion="cancelled"`). On `head` (ahead of `merge_sha`), return only `CI` (`workflow_id=1`, `conclusion="success"`). Assert `dev_results()` keeps `j["dev_result"] == "red"` rather than `"green"`.
- **Alternative fix and trade-off:** Remove `cancel-in-progress: true` on `push: branches: [dev]` in `images.yml:15` (`cancel-in-progress: ${{ github.event_name != 'push' }}`). Prevents intermediate `dev` image builds from cancelling earlier `merge_sha` verification runs, at the cost of extra GitHub-hosted runner minutes during rapid merges.

## Confidence

`proven`
