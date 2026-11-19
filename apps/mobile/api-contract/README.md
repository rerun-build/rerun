# The contract of the mobile API

A build of the app keeps the schemas of `@rerun/contracts` it was compiled with for as long as it is
installed, while the hub always runs the latest ones. This folder holds what every build in people's
hands reads, so that no change to the hub can break one of them unseen.

| File | What it is |
|---|---|
| `current.json` | The registry of today (`mobileApi`, `packages/contracts/src/mobile-api.ts`) as OpenAPI 3.0: every call the app makes, what it sends, what it reads. Generated, committed: a change to the mobile API shows in the diff of its pull request. |
| `shipped/<platform>-<build>.json` | What one build reads, frozen when it shipped: the registry with the schemas of the build's own commit. Never edited. |
| `shipped/<platform>-<build>.adapted` | The changes this build still reads: the hub answers it differently (`apps/ui/app/api/v1/_lib/legacy-client.ts`), or it never sends what the change refuses. Each line names one change of `oasdiff`, and only that change, under a comment that says why. |
| `shipped/<platform>-<build>.broken` | The changes that break this build and that no answer of the hub can help. `check` prints them as `known` instead of `ok`. Only for a build on its way out: it leaves once nobody runs it. |
| `chat-stream.json` | The kinds of chunk the engine streams in a chat, as the app's AI SDK reads them. |

## Commands

```bash
pnpm build:contracts && pnpm mobile:contract           # regenerate current.json after changing the registry
pnpm mobile:contract:check                             # current.json is up to date, and no shipped build breaks
pnpm mobile:contract:snapshot ios 39                   # freeze a build that ships now (testflight, store-submit)
pnpm mobile:contract:snapshot ios 36 --commit 90c4df1  # freeze an older build from the schemas of its commit
```

`check` compares every snapshot with today's contract through
[oasdiff](https://github.com/oasdiff/oasdiff) `breaking`, which knows the side of each change: a new
value of an enum breaks a response and not a request, a field that becomes required breaks a request and
not a response. It fails on its warnings too. The binary (pinned, checksum checked) is downloaded once
into `packages/contracts/node_modules/.cache/mobile-contract`. The tests of the hub check that
`current.json` is the file the registry generates.

## Which builds are here

iOS 18 to 38 and Android 3 to 7, every build of the production channel the hub still serves.

iOS 18 to 21 (25 to 27 October 2026) need two things:

- the email sign-in: they require `created` in the answer of `POST /api/v1/auth/email/code`. The hub adds
  it for the builds below 23, always `false`, so that it never tells who holds an account (`.adapted`);
- the sign-in to Claude and ChatGPT: they send and read `verifier`, `state`, `deviceAuthId` and
  `userCode`, which a sealed ticket replaced. No answer helps there (`.broken`): once `app_build_days`
  shows nobody on them, raising `MOBILE_IOS_MIN_BUILD` to 23 sends the last ones to the store.

## Retiring a build

Only once nobody runs it: the hub counts, in `app_build_days`, one row per person, build and day of the
calls to `/api/v1` (`apps/ui/app/api/v1/_lib/build-days.ts`). Then raise the minimum build of its platform
(`MOBILE_IOS_MIN_BUILD`, `MOBILE_ANDROID_MIN_BUILD`), delete its snapshot, its `.adapted` and its `.broken`, then the
adaptations of `legacy-client.ts` no build left needs.

## A build that ships

The release runs `pnpm mobile:contract:check` before it pushes, and CI runs it on every pull request to
`master`. Each build sent to the stores gets its snapshot, from the commit it was built from:

```bash
pnpm build:contracts && pnpm mobile:contract:snapshot ios 39 --commit <gitCommitHash of the EAS build>
```
