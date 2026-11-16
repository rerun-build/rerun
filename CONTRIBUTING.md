# Contributing to Rerun

Thank you for helping. This page covers running Rerun from source, the shape of the code, and how a
pull request gets in.

## Run it from source

You need Node 22, pnpm 8 (`corepack enable`), Docker (for the local Supabase) and an OpenRouter key.
Work from `dev`, the branch a plain `git clone` lands on.

```bash
pnpm install
npx supabase start                 # Postgres, auth, storage and Mailpit on ports 54420 to 54429
pnpm --filter @rerun/contracts build
cp .env.example .env
```

In `.env`, set these, then let the check generate the secrets and test Supabase:

| `.env` | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3050` |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://localhost:54421` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | the keys `npx supabase status` prints |
| `OPENROUTER_API_KEY` | your OpenRouter key |

```bash
node scripts/self-host-check.mjs   # fills the secrets left empty
cp .env apps/ui/.env
printf 'RERUN_ENGINE_URL=http://localhost:3000\nRERUN_ENGINE_BROWSER_URL=http://localhost:3000\n' >> apps/ui/.env
cp apps/engine/.env.example apps/engine/.env
```

Ignore the `docker compose` command the check prints. `RERUN_ENGINE_URL` gives the engine below to the first workspace that needs
one, and `RERUN_ENGINE_BROWSER_URL` is where your browser opens its screen.

Then fill `apps/engine/.env`:

| `apps/engine/.env` | Value |
|---|---|
| `RERUN_API_KEY` | the `RERUN_ENGINE_API_KEY` the check wrote in `.env` |
| `RERUN_HUB_BASE_URL` | `http://localhost:3050` |

Start both, each in its own terminal:

```bash
pnpm dev:engine    # http://localhost:3000
pnpm dev:ui        # http://localhost:3050
```

Sign-in codes land in Mailpit, at http://localhost:54424. To work on the docs, run `pnpm dev:docs`
and open http://localhost:3333.

## Checks

```bash
pnpm -r --if-present ts-check
pnpm --filter rerun lint
pnpm --filter rerun test
pnpm --filter rerun-engine test
pnpm --filter rerun-mobile test
pnpm --filter rerun-desktop test
pnpm i18n:check
```

CI (`.github/workflows/ci.yml`) runs these, builds the desktop app, applies every migration and the
seed to an empty database, builds both Docker images and the desktop installers, and tests the
Android native modules. It runs on every push and pull request to `master` and `staging`. A pull
request to `dev` does not start it, so run the checks yourself before you open one.

## The code

| Path | What it is |
|---|---|
| `apps/ui` | The web app and its API (Next.js). Talks to Supabase and to the engine of each workspace |
| `apps/engine` | The engine: runs the coworkers, their tools, their memory, their browser and screen |
| `apps/mobile` | The iPhone and Android app (Expo) |
| `apps/desktop-app` | The desktop app (Electron) |
| `apps/docs` | The documentation (Mintlify) |
| `packages/contracts` | Types and schemas shared by the app, the engine and the mobile app |
| `packages/ui` | The design system and the board |
| `packages/i18n` | The language packs: English is the source, the others are generated |
| `supabase/migrations` | The database schema, one migration per change |

`CLAUDE.md` holds the conventions of the codebase (and is what coding agents read): Supabase access
through the typed helpers, responsive from the first version, every visible string through the
language packs, migrations of the engine data-dir.

A schema change is a new migration: `pnpm db:new <name>` creates the file, and `pnpm db:reset`
replays every migration and the seed on the local stack.

`@rerun/cloud/*` is the seam where Rerun Cloud plugs in what it runs differently: billing, paid
apps, its machine pool, push notifications. In this repository it resolves to `apps/ui/cloud-oss/`,
the self-hosted behaviour. Pull requests that change what it exports are unlikely to be merged.

## Pull requests

1. Open an issue first for anything bigger than a fix, so we agree on the direction.
2. Branch from `dev` and open the pull request against `dev`.
3. Keep a pull request to one change, with tests where the code has them, and fill the template.

`dev` is the working branch. A release moves `master` to `dev`, publishes the version tag and its
release notes, and is the code Rerun Cloud runs, so a merged pull request ships to both.

We will not take: anything that changes what `apps/ui/cloud-oss/` exports, a dependency with a
license incompatible with the AGPL, or a feature that only makes sense for one deployment.

A security issue never goes in a public issue or pull request: see [SECURITY.md](SECURITY.md).
