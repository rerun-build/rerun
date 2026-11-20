# `D16`: CI Gate Workflows Break on Next.js `(group)`/`[slug]` Filenames (`no-comments.yml` Unquoted `$(cat)`), Can Be Skipped via Branch Names (`red-green`, `refactor-frozen`), and Are Not Explicitly Required by `dispatch.checks()`

- **Finding:** `no-comments.yml:39` passes unquoted `$(cat /tmp/changed.txt)` to bash (expanding Next.js `[slug]` brackets as shell globs and word-splitting spaces), `red-green.yml:19` and `refactor-frozen.yml:14` skip any PR whose branch does not start with `chunk/`, `refactorcheck.py:10` only checks commits starting with `^refactor\b`, and `dispatch.checks()` (`dispatch.py:503-517,1730-1732`) checks no required list of workflow names — so a PR can merge before slow-to-register gate workflows appear in `workflow_runs` or when a PR edits the gate scripts themselves.

## Evidence

- `.github/workflows/no-comments.yml:37-39`:
  ```yaml
          git diff --name-only --diff-filter=AM HEAD^1 HEAD > /tmp/changed.txt
          if [ ! -s /tmp/changed.txt ]; then echo "No added or changed files."; exit 0; fi
          python -I scripts/strip-comments/strip.py --root . --ts-module /tmp/ts --check --only $(cat /tmp/changed.txt)
  ```
- `.github/workflows/red-green.yml:19` & `.github/workflows/refactor-frozen.yml:14`:
  ```yaml
        startsWith(github.head_ref, 'chunk/')
  ```
- `tools/factory/redgreen.py:28-32,45-46`:
  ```python
  def exempt(body):
      m = re.search(r"(?mi)^\*\*Red before green\*\*:\s*not applicable\b(.*)$", (body or "").replace("\r\n", "\n"))
  ```
- `tools/factory/dispatch.py:503-517,1730-1732`:
  ```python
  def checks_verdict(runs):
      if not runs:
          return "WAIT", "no workflow runs yet"
      pending = ciwait.unfinished(runs)
      if pending:
          return "WAIT", ciwait.pending_text(pending)
      ...
      return "OK", None
  ```
- **Command / test run:** `wsl -e sh -c "cd /mnt/e/project/moldwright && python3 -I -m unittest discover -s scripts/no-stubs -p 'test_*.py' && cd tools/factory && python3 -m unittest test_redgreen test_refactorcheck"`
  ```text
  Ran 6 tests in 0.000s (OK)
  Ran 39 tests in 1.453s (OK)
  ```

## Trigger

1. **`no-comments.yml:39` shell globbing & word-splitting on Next.js App Router paths:**
   - Unquoted `$(cat /tmp/changed.txt)` undergoes POSIX word-splitting (`IFS`) and pathname glob expansion (`[`, `]`, `*`, `?`).
   - Next.js routes in `apps/ui/app/` heavily use bracket segments like `app/api/t/[agentId]/[slug]/[token]/route.ts` or `app/published-site/[slug]/[[...path]]/route.ts`! In bash without `nullglob`, `[s]` or `[a]` matches single-character sibling directories if any exist (expanding to the **wrong** path and skipping the `[slug]` file from `--only`!), while any path containing whitespace splits into broken arguments and crashes `strip.py`!
2. **`dispatch.checks()` does not verify expected workflow names (`dispatch.py:503-517,1730-1732`):**
   - `checks_verdict(runs)` returns `"OK"` as soon as `runs` is non-empty and every workflow run *currently listed in `runs`* has completed with `OK_CONCLUSIONS` (`{"success", "skipped", "neutral"}`).
   - First, if GitHub registers a fast workflow (`No stubs` finishes in ~8s!) before `CI` or `Done-test red before green` has even created its `workflow_run` entry on a newly pushed SHA, `runs` contains `[No stubs (completed/success)]` and `checks_verdict` returns `"OK"` immediately!
   - Second, `"skipped"` is in `OK_CONCLUSIONS`, so a non-`chunk/*` branch skips `red-green.yml` and `refactor-frozen.yml` completely while still passing `checks_verdict`.
3. **Self-modification & trivial bypasses in `no-stubs`, `redgreen`, and `refactorcheck`:**
   - `scripts/no-stubs/check.py:27` skips `if not path.startswith("scripts/no-stubs/"):`, and neither `no-stubs.yml` nor `red-green.yml` blocks a coworker PR from modifying `scripts/strip-comments/strip.py` or `tools/factory/redgreen.py` (`gatefiles.py` only asks a second LLM reviewer).
   - `scripts/no-stubs/check.py:5-7` misses `vi.fn()` / `test.todo(...)` / `it.todo(...)` in Vitest!
   - `refactorcheck.py:10` matches only commit subjects starting with `^refactor\b`; naming a refactor commit `chore: clean up ...` or `fix: simplify ...` bypasses `refactor-frozen.yml` completely.

## Impact and severity

- **Severity:** `high`
- **Impact:** `dispatch.checks()` can merge a PR during the GitHub Actions registration window after the fastest workflow (`no-stubs` / `refactor-frozen`, ~10s) completes before `CI` or `red-green` spawns, `no-comments.yml` mishandles bracket/space filenames, and `it.todo(` / `test.todo(` bypass `no-stubs`.

## Proposed fix

- **Smallest causal change (`.github/workflows/no-comments.yml`, `scripts/no-stubs/check.py`, `tools/factory/dispatch.py`):**
  1. In `.github/workflows/no-comments.yml:37-39`, use NUL-delimited `git diff -z` + `xargs -0`:
     ```sh
     git diff -z --name-only --diff-filter=AM HEAD^1 HEAD > /tmp/changed.bin
     if [ ! -s /tmp/changed.bin ]; then echo "No added or changed files."; exit 0; fi
     xargs -0 python -I scripts/strip-comments/strip.py --root . --ts-module /tmp/ts --check --only < /tmp/changed.bin
     ```
  2. In `tools/factory/dispatch.py:503` (`checks_verdict`), require all mandatory PR workflows (`{"CI", "No comments in code", "No stubs or switched-off tests", "Done-test red before green", "Refactor commits leave tests alone"}`) to be present in `runs` (and `CI` to have `conclusion == "success"`, never `"skipped"`) before returning `"OK"`.
  3. In `scripts/no-stubs/check.py:7`, add `\b(?:it|test|describe)\.todo\s*\(` to the `skipped test` regex.
- **Must not break:** Docs-only or factory-only PRs where `CI` still runs `route`/`check`/`tests` and `Done-test red before green` exits 0 when `not applicable` or no `Run` lines.
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_dispatch.py` and `scripts/no-stubs/test_check.py`
  - **Test name:** `test_checks_waits_until_ci_and_gate_workflows_have_registered` and `test_catches_vitest_it_todo`
  - **Assertion:** Pass `runs = [{"id": 1, "workflow_id": 1, "name": "No stubs or switched-off tests", "status": "completed", "conclusion": "success"}]` (missing `"CI"`) to `checks_verdict` and assert `"WAIT"`; pass `+  it.todo('later')` to `check.find` and assert 1 hit.
- **Alternative fix and trade-off:** Configure a GitHub branch ruleset on `dev` requiring those 5 status checks at the repository level so even `gh pr merge` fails with HTTP 405 until every required check has reported.

## Confidence

`proven`
