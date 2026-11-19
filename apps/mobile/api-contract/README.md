# The contract of the mobile API

A build of the app keeps the schemas of `@rerun/contracts` it was compiled with for as long as it is
installed, while the hub always runs the latest ones. This folder holds what every build in people's
hands reads, so that no change to the hub can break one of them unseen.

| File | What it is |
|---|---|
| `current.json` | The registry of today (`mobileApi`, `packages/contracts/src/mobile-api.ts`) as OpenAPI 3.0: every call the app makes, what it sends, what it reads. Generated, committed: a change to the mobile API shows in the diff of its pull request. |
| `shipped/<platform>-<build>.json` | What one build reads, frozen when it shipped: the registry with the schemas of the build's own commit. Never edited. |
| `shipped/<platform>-<build>.adapted` | The changes the hub answers this build differently, so it still reads them (`apps/ui/app/api/v1/_lib/legacy-client.ts`). Each line names one change of `oasdiff`, and only that change. |
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

iOS 23 to 38 and Android 3 to 7, every build of the production channel the hub still serves.

iOS 18 to 21 (25 to 27 October 2026) are left out: today's hub already breaks two of their paths, and no
answer the hub could give fixes them:

- the email sign-in: they require `created` in the answer of `POST /api/v1/auth/email/code`, which the hub
  stopped sending so that it does not tell who holds an account;
- the sign-in to Claude and ChatGPT: they send and read `verifier`, `state` and `deviceAuthId`, which a
  sealed ticket replaced.

Raising `MOBILE_IOS_MIN_BUILD` to 23 sends the people still on them to the store.

## Retiring a build

Only once nobody runs it: raise the minimum build of its platform (`MOBILE_IOS_MIN_BUILD`,
`MOBILE_ANDROID_MIN_BUILD`), delete its snapshot and its `.adapted`, then the adaptations of
`legacy-client.ts` no build left needs.
