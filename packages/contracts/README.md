# @rerun/contracts

The types, zod schemas and small pure helpers that more than one side of Rerun has to agree on: an
agent and its capabilities, a chat message and its cards, a run, a schedule, a trigger, a template,
the plans and prices (`src/billing.ts`), the API the mobile app calls, and generic helpers such as
`sleep` or the name of a tool part. One file per domain under `src/`, all re-exported by `src/index.ts`.

## The mobile API

`src/mobile-api.ts` lists every call the mobile app makes to the hub, from every build still allowed
to run: its method, its path, its body, its query, what it answers and the failures the app tells
apart (`HubEndpoint`, `src/hub-endpoint.ts`). A build keeps the schemas it was compiled with for as
long as it is installed, so an entry is a promise to every build in the stores: add to it, never
change what an entry accepts or answers in a way a shipped build cannot read.

## Who imports it

`apps/engine`, `apps/ui`, `apps/mobile`, `apps/desktop-app` and `packages/ui`. A change here is a
change to every one of them: rename or drop an export only with all its callers in the same pull
request.

## Build

It is the only package that ships compiled: the others import `dist/`, not `src/`.

```bash
pnpm build:contracts                       # from the root, once after install and after every change
pnpm --filter @rerun/contracts dev         # tsc --watch while you work on it
pnpm --filter @rerun/contracts clean       # drop dist/
```

The Docker image of the hub, the EAS builds (`eas-build-post-install`) and `pnpm dev:desktop` build it
themselves. It has no tests of its own: the engine and the hub test what they do with it.

## Rules

- No dependency on a runtime: no Node, React, Next or Supabase import, only `zod`. The same file runs in
  the engine, the browser, the phone and Electron.
- Relative imports end in `.js` (`from './board.js'`): the package is ESM compiled by `tsc`.
- Before writing a generic helper anywhere in the monorepo, look for it here first, and move a helper
  here once a second package needs it (root `CLAUDE.md`, "Shared helpers").
