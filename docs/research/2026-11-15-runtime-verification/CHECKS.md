# How checks run against the running app
as_of 2026-11-15, dev 616c598. Part of #516. No code is written by this document; child 2 (the script and its workflow) builds what it decides.

## Liveness

Every run starts with three liveness lines, one each for the app, the engine and the dispatcher, and every result prints all three even when the first one fails. They are separate because each fails on its own and each has a different person to wake: a green app says nothing about the engine, and a dead dispatcher stops the factory without any page showing an error.

- App: `GET /api/version` must answer 200 with a non-empty `buildSha` (`apps/ui/app/api/version/route.ts:1`). It sits outside the session proxy matcher in `apps/ui/proxy.ts`, so it answers without a session or a redirect to `/auth`, which makes it a clean signal. Result line: `PASS liveness-app buildSha=<first 7 characters>`.
- Engine: `GET /health` must answer JSON with `status: "ok"` (`apps/engine/src/http/routes/health.ts:16`). Compose publishes it on `RERUN_ENGINE_PORT`; the VPS file puts it behind traefik on `RERUN_ENGINE_HOST`. A GitHub runner can reach it only if that host is public; otherwise the line is `SKIP liveness-engine not reachable from here` and the server job runs it. Result line: `PASS liveness-engine status=ok`.
- Dispatcher: it has no HTTP port. `Dispatcher.heartbeat` (`tools/factory/dispatch.py:809`) rewrites `heartbeat_file` (default `/state/heartbeat`, line 824) once per beat, and `runner.json` sets `poll_s` to 30. Only a process on the server can read that file. The check reads its modification time and passes when the file is younger than 180 seconds, which is six polls: one or two late beats (a slow GitHub call) must not raise a false alarm, while six missed beats mean the loop is stuck or dead. The check does not print the file content. A missing file is FAIL, not SKIP, on the server. Result line: `PASS liveness-dispatcher age=<n>s`.

Why 180 and not 60: the beat is written once per poll, and a poll can run long while a job is being reported; 60 s would fire on ordinary slowness and teach the owner to ignore the alert.

Owner decides: the stale age of 180 s is a recommendation; say if the owner wants a different one.

## Where checks run

Pick (c), both, built in two steps. A `workflow_dispatch` GitHub workflow against `https://rerun.robagentic.tech` ships first (child 2) and runs the anonymous checks plus the app line. A server job is added after it and runs the engine line and the dispatcher line, which a GitHub runner cannot read.

- (a) GitHub workflow only: nothing to install on the server and the result sits beside the code. Against it: it cannot read the dispatcher heartbeat, and it reaches the engine only if the engine host is public. Alone it would leave two of three liveness lines as SKIP forever.
- (b) Server job only: it sees all three lines. Against it: it needs a place to run (cron or a compose service) that does not exist today, and its result is not visible in GitHub unless it posts there.
- (c) Both: each place runs the lines it can reach, so no line is always SKIP, and the workflow can start without any server change.

What fires a run. `.github/workflows/release.yml` builds images for `rerun-build/rerun` only and nothing in `.github/workflows` deploys; the deploy is `deploy/vps/update.sh` (steps 1/4 to 4/4, then `docker compose ps`), run on the server. So "after a release" has no GitHub trigger today.

- By hand with `workflow_dispatch`: free, nothing can fire unexpectedly, and the first version needs no more. Cost: it depends on the owner remembering.
- As a last step of `update.sh`: it runs exactly after every deploy, which is the moment that matters. Cost: a change to a script that runs on the live server, and a failed check must not make a finished deploy look failed, so that step prints the result and never changes the exit code of the update.
- On a schedule: catches breakage that no deploy caused. Cost: a run every period whether or not anything changed, and a flapping site produces repeated alerts.

Pick: version 1 is `workflow_dispatch` only (as child 2 builds it). The next addition is the `update.sh` last step, running the server job. A schedule is added only for the three liveness lines, every 15 minutes, once the owner has seen the results are trustworthy.

Owner decides: whether the engine host (`RERUN_ENGINE_HOST`) is public, and whether he accepts a change to `update.sh`.

## What a check may touch

A check is read-only. The rule the proof step tests:

- GET requests only; no POST, PUT, PATCH or DELETE.
- No redirect is followed unless the check is about the redirect (`/settings`, `/`); there the status and `Location` header are the proof.
- No stored data is changed: no row, file, setting, key or workspace is created or edited.
- No message, email, invitation, publish or run is started in the owner's name.
- No secret is printed in a result, in a log line or in an error message; a header or body that may carry one is not echoed.
- A response body is read up to a fixed size (64 KB) and then dropped, so a wrong answer cannot flood the runner.

Why: the app is live and has real data and a real owner. A check that writes leaves residue and can mail real people; a check that follows redirects blindly hides the very redirect it should see.

Rows of FEATURES.md whose "what proves it works" needs a write:

- Home board and Foreman chat, sending a Foreman message: `needs a write: not in the first versions`.
- Agent panel, changing an agent's model: `needs a write: not in the first versions`.
- Brain, saving a page: `needs a write: not in the first versions`.
- Email preferences, saving a preference: `needs a write: not in the first versions`.

For these rows only the read half is checked (the page loads), and the write half is reported as `SKIP <name> needs a write`.

## Signed-in checks

Nobody signs in for the owner, so any signed-in check waits for steps only he can do. Pick: signed-in checks are not in version 1, because every anonymous check and all three liveness lines give value without an account, and an account adds a secret to guard.

Before a signed-in check can exist the owner must:

1. Create a separate check account, used for nothing else. The app has a password form at `/auth?method=password` (`AuthPageMethods.tsx`, `passwordOnly`), which suits an account with no mailbox to read codes from.
2. Put its credential in a GitHub secret that he sets himself in the repository settings. It is never put in a file, an issue, a comment or a chat.
3. Create or approve a workspace that belongs only to that account and holds nothing real, so a check that lands in the wrong place owns nothing worth losing.

Until he does this, unchecked are: Home board and Foreman chat as a signed-in user, the dialogs (account, workspace, members, API keys, knowledge base, new agent), notifications and inbox, control center, workspace invitation, Brain, files and data, connections, and the agent panel. These are reported as `SKIP <name> needs the check account`.

Owner decides: whether to create the check account at all, and when.

## What a result looks like

One line per check: `PASS|FAIL|SKIP <name> <detail>`, the format child 2 prints, ending with a summary line and a non-zero exit code on any FAIL. A SKIP never fails the run, but it is printed so that a gap is visible and not silently green.

Where the owner sees it:

- The workflow summary: every run, full list. This is the only place in version 1.
- The Factory page (`apps/ui/app/(dashboard)/factory/page.tsx` polls `readFactorySnapshotAction` every 30 s): the snapshot gets a runtime-checks entry (last run time, count of FAIL, the three liveness lines). That is a change to the snapshot and its action, so it is its own job, owned by the builder of the Factory page, after the server job exists; before then the page has nothing to read.
- A GitHub issue per newly failing check, deduplicated by check name: if an open issue with that check name exists, a comment is added instead. This keeps a flapping check from filling the tracker.
- A push to the owner only for a failed liveness line, because only those mean the product or the factory is down. A failed content check waits in the issue.

How a failure is cleared: the next run that passes the check closes its issue with a comment naming the run. Who is woken: the owner for liveness, through the push; for any other check the issue is picked up by the factory like any labelled issue, and nobody is woken.

Owner decides: whether the push for a failed liveness line goes to his phone or to the Factory page only.

## Cost per run

Tokens: 0, because no model is called. Runner minutes: one workflow run, bounded by `timeout-minutes: 5`, so the worst case is 5 minutes and a normal run is well under one. Server cost of the server job: a handful of HTTP requests, one file stat and a few milliseconds of CPU; no extra container. No paid service is involved: the runner minutes of a repository fall in the existing GitHub plan, and the check calls only the owner's own hosts. If a later job adds a paid service (an external uptime monitor, a hosted browser), it is marked for the owner's approval before it is built.

## Order of features

The first set is the rows already verified in FEATURES.md, all anonymous and read-only:

1. Liveness (three lines).
2. `GET /settings` redirects to `/` (`apps/ui/app/settings/page.tsx:4`).
3. `GET /redeem` answers 404 (`apps/ui/cloud-oss/redeem.tsx:11`).
4. `/auth` renders an email input (`apps/ui/components/auth/EmailCodeForm.tsx:172`; present in the server HTML on the live site).

Then, from "First runtime checks to write" in FEATURES.md (that order is an inference, not usage data), with the kind of each:

- Published site, gate and viewer: anonymous; needs the owner's `PUBLISH_HOST` value for the `Host` header.
- Dialogs (account, workspace, members, API keys, knowledge base, new agent): needs the check account.
- Notifications and inbox: needs the check account.
- Workspace invitation: needs the check account; accepting an invitation is a write, so only the page load is checked.
- Control center: needs the check account.
- Email preferences (unsubscribe): anonymous for the page load; saving a preference needs a write.
- Desktop remote view: needs the check account.
- Changelog and What's new: anonymous if the page is public; otherwise needs the check account.
- Share cards and OG images: anonymous (404 and ready-marker checks).
- Creator invite and terms: needs the check account.

Reason for the order: anonymous checks come first because they need no secret and no owner step, so they can ship at once; signed-in ones wait for the account.

**Corrections**

- The unknown-slug 404 is only seen through a published host: `GET /published-gate/<slug>` answers 404 for every slug, because `apps/ui/app/published-gate/[slug]/page.tsx:79` calls `notFound()` when the request is not on the slug's own host. A check must send `Host: <slug>.<PUBLISH_HOST>` (the proxy rule is `apps/ui/proxy.ts:68`; `PUBLISH_HOST` is read in `apps/ui/lib/published/host.ts`). Its live value is not in the repository.
- On 2026-11-15 the live `/` answers 307 to `/auth` for an anonymous visitor.
- FEATURES.md names dev `4296d1f`; dev is now `616c598`.

Owner decides: the live value of `PUBLISH_HOST`.
