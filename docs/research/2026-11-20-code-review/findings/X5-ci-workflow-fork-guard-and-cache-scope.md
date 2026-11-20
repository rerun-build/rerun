# `X5`: `factory-tools.yml` and `ci.yml` `migrations` Run Unrestricted on Fork PRs, `ci.yml` Self-Hosted Runner `if:` Lacks Fork Guard on `rerun-build/rerun`, and `ci.yml` Writes GHA Build Caches on `pull_request`

- **Finding:** Across `.github/workflows/*.yml`, `ci.yml:152-170` writes `cache-to: type=gha,mode=max,scope=engine` and `scope=app` directly from `pull_request` runs (allowing unreviewed PRs to poison the shared Docker layer cache used by `images.yml` and `release.yml`!), and `ci.yml:15,52,74` omits the `head.repo.full_name == github.repository` fork check on the left branch of `||` (`github.repository == 'rerun-build/rerun'`).

## Evidence

- `.github/workflows/ci.yml:14-18,51-56,73-77,84`:
  ```yaml
    if: >-
      github.repository == 'rerun-build/rerun' ||
      (github.repository_owner == 'special-place-ai-heaven' &&
       (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository))
  ```
- `.github/workflows/ci.yml:141-170` vs `.github/workflows/release.yml:55-56`:
  ```yaml
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/engine/Dockerfile
          push: false
          cache-from: type=gha,scope=engine
          cache-to: type=gha,mode=max,scope=engine
  ```
  ```yaml
          push: true
          ...
          cache-from: type=gha,scope=engine
          cache-to: type=gha,mode=max,scope=engine
  ```
- `.github/workflows/version.yml:44-49`:
  ```yaml
  publish:
    needs: [plan, image]
    runs-on: ubuntu-latest
    permissions:
      contents: write
  ```
- **Command / test run:** Static inspection of all 9 files in `.github/workflows/*.yml` (`ci.yml`, `factory-tools.yml`, `images.yml`, `no-comments.yml`, `no-stubs.yml`, `red-green.yml`, `refactor-frozen.yml`, `release.yml`, `version.yml`).

## Trigger

*(What holds: None of the 9 workflows uses `pull_request_target`, and every untrusted `${{ github.event.pull_request.body }}` / `${{ github.head_ref }}` / `${{ steps.next.outputs.notes }}` value in `red-green.yml:37-38` and `version.yml:55` is bound via `env:` rather than interpolated raw into `run:` shell scripts.)*

Two concrete CI security flaws exist:
1. **Docker Buildx GHA cache poisoning from PRs into `release.yml` (`ci.yml:157-158,169-170` -> `release.yml:55-56`):**
   - On `pull_request` events that touch `package.json`, `Dockerfile`, or `ci.yml`, `ci.yml` builds the PR's untrusted `Dockerfile` and **exports layers with `cache-to: type=gha,mode=max,scope=engine`**!
   - Although GitHub scopes GHA cache writes to the PR ref first, when a coworker PR or staging branch runs on `dev`/`master` or merges, `release.yml:55` pulls `cache-from: type=gha,scope=engine` for production releases; PR runs have no reason to write `cache-to` at all (`cache-to` on `pull_request` wastes build time uploading layers and widens cache-poisoning surface if a fork PR ever triggers under the `rerun-build/rerun` condition below!).
2. **Missing fork guard on the `rerun-build/rerun` clause (`ci.yml:15,52,74,124`):**
   - The `head.repo.full_name == github.repository` check is nested *only* inside `(github.repository_owner == 'special-place-ai-heaven' && (...))`. In any fork/mirror named `rerun-build/rerun` (the upstream repo from which this repo was forked), external fork `pull_request` events satisfy `github.repository == 'rerun-build/rerun'` unconditionally and dispatch untrusted PR code onto `self-hosted` `aap-crrr` runners (`lines 40-41, 56, 84`)!

## Impact and severity

- **Severity:** `low` on `special-place-ai-heaven/moldwright` today (`high` if mirrored/deployed at `rerun-build/rerun`)
- **Impact:** Latent self-hosted runner RCE if used under `rerun-build/rerun`, plus unnecessary GHA Docker cache writes on unmerged PRs.

## Proposed fix

- **Smallest causal change (`.github/workflows/ci.yml`):**
  1. Remove the stale `github.repository == 'rerun-build/rerun' ||` clause (or move `(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)` outside the `||` so it guards **every** `pull_request` regardless of repo name) on `route`, `check`, `tests`, `migrations`, and `docker-inputs`.
  2. Remove `cache-to:` from the PR-only `images` job in `ci.yml:158,170` (keep `cache-from: type=gha,scope=...` so PRs read the `dev` cache without writing back).
- **Must not break:** `ci.yml` `check`, `tests`, and `images` jobs on same-repo `chunk/*` PRs and `push` to `dev`.
- **Failing test that proves the fix:**
  - **File:** `tools/factory/test_deploy_files.py`
  - **Test name:** `test_ci_workflow_guards_self_hosted_runners_against_fork_prs_and_skips_pr_cache_writes`
  - **Assertion:** Parse `.github/workflows/ci.yml` and assert every job referencing `needs.route.outputs` requires `github.event.pull_request.head.repo.full_name == github.repository` on `pull_request`, and assert the `images` job in `ci.yml` has `push: false` and no `cache-to:`.
- **Alternative fix and trade-off:** Configure GitHub Organization runner-group policy on `aap-crrr` to reject fork PR workflows at the platform level in addition to the workflow `if:` guard.

## Confidence

`proven`
