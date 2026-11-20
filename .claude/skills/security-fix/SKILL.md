---
name: security-fix
description: Fix a vulnerability in private, through the temporary private fork of a GitHub security advisory, never through a branch of the public repository (every branch pushed to special-place-ai-heaven/moldwright is public at once). Use whenever the work is a vulnerability fix, a security audit finding, a private report ([EMAIL] or "Report a vulnerability"), or when someone says "security fix", "fix this vulnerability", « correctif de sécurité », « corrige cette faille », « fix de sécu », or when the pre-push hook refused a push for mentioning a vulnerability.
---

# security-fix: a vulnerability fix stays private until it is published

Reply in the user's language.

## Why

`special-place-ai-heaven/moldwright` is public and is the working repository: a pushed branch is visible at once, even
without a pull request, and its commit message alone can point at the hole. A fix is written in the
temporary private fork of a GitHub security advisory, and becomes public only when the advisory is
published, once Rerun Cloud already runs it.

## The flow

1. **A workspace of its own.** A new Conductor workspace (or worktree), on a branch that was never
   pushed. Never in a workspace that already pushed the branch.
2. **Lock it.** From that workspace:

   ```bash
   pnpm security:start "<short title, no exploit details>" --severity high
   # an advisory that already exists (a private report):
   pnpm security:start --advisory GHSA-xxxx-xxxx-xxxx
   ```

   It opens the draft advisory and its private fork, adds the fork as a remote named after the
   GHSA id, makes it the push target, and breaks the push URL of `origin` **in this worktree only**.
   `git fetch origin` still works.
3. **Fix and test locally.** GitHub Actions does not run in an advisory fork: run the typecheck, the
   tests and the in-app check yourself.
4. **Push and open the pull request in the fork:** `git push`, then
   `gh pr create --repo special-place-ai-heaven/moldwright-ghsa-xxxx-xxxx-xxxx --base dev`.
5. **Ship Rerun Cloud before publishing.** Rerun Cloud builds from a public commit. Deploy it from the
   fork first (its Dockerfiles take `UPSTREAM_REPO` and `UPSTREAM_TOKEN` for a private upstream), following
   the release notes in `cloud/`.
6. **Merge and publish** from the advisory page, then release. Fill in the advisory's description
   and credit the reporter before publishing.

## Rules in that workspace

- Never push to `origin`, never `ALLOW_PUBLIC_PUSH=1`, never put the push URL back.
- Never use the GitHub MCP write tools (`push_files`, `create_or_update_file`, `create_pull_request`,
  `create_branch`…) there: they write to GitHub without going through git, so the lock does not apply.
- No exploit details in commit messages, branch names or the pull request title until publication.
- A test advisory is closed by hand afterwards, and its fork stays: delete it from the fork's settings.

## The pre-push hook (every workspace)

`scripts/git-hooks/pre-push` (installed by `pnpm install` through `core.hooksPath`) refuses a push to
the public repository when a branch name or a new commit message says `security`, `XSS`, `SSRF`,
`CVE-…`, `bypass`, `injection`, `leak`… It is a safety net that reads words only, and `--no-verify`
skips it: a fix titled "check workspace ownership" goes through. The lock of `security:start` is what
protects. A false positive (a change that is not a vulnerability fix) is pushed with
`ALLOW_PUBLIC_PUSH=1 git push`.
