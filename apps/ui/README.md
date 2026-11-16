# rerun (apps/ui)

The hub of Rerun: the web app and its API, in Next.js. It signs people in and keeps workspaces,
coworkers, Boxes and billing in Supabase, and talks over HTTP to the engine of each workspace
(`apps/engine`), which runs the coworkers. It also serves the desktop app (`app/api/desktop`), the
mobile app (`app/api/v1`) and the MCP server that API keys reach (`app/api/mcp/account`).

## Run it

From the root of the monorepo, with the local Supabase running (`pnpm db:start`) and
`@rerun/contracts` built once (`pnpm build:contracts`):

```bash
pnpm dev:ui        # the hub, on http://localhost:3050
pnpm dev:engine    # an engine beside it, on http://localhost:3000
pnpm dev:ui:full   # both in one terminal
```

`CONTRIBUTING.md` at the root walks through a first run from a bare checkout.

## Environment

The hub reads `apps/ui/.env`. Start from the `.env.example` at the root of the repository
(`cp .env.example apps/ui/.env`) and fill the values `CONTRIBUTING.md` lists. Every variable, its
default and what happens when it is empty: `apps/docs/self-host/configuration.mdx`.

## Open source and Rerun Cloud

What Rerun Cloud runs differently is imported from `@rerun/cloud/<domain>`. Without the private
`cloud/` folder in the checkout, that resolves to `apps/ui/cloud-oss/<domain>`, the behaviour of a
self-hosted install (`paths` in `tsconfig.json`, the alias in `vitest.config.ts`).
`ee/` and `app/(ee)/` (billing and plans, the Rerun credit, the template marketplace) are under the
commercial license of `ee/LICENSE`, and the open source build never switches them on.

## Scripts

Run from `apps/ui`, or from the root with `pnpm --filter rerun <script>`:

| Script | What it does |
| --- | --- |
| `dev` | `next dev` on port 3050 |
| `build`, `start` | the production build, and serving it |
| `test` | the unit tests (Vitest), `test:coverage` with coverage |
| `lint` | ESLint |
| `ts-check` | `tsc --noEmit` |

`ts-check` reads the route types Next generates under `.next/`: on a fresh checkout, run `next dev`
once or `pnpm --filter rerun exec next typegen` first. The tests resolve `@rerun/cloud/*` like the
app, so a test that checks Rerun Cloud's behaviour pins the module it reads with `vi.mock`.

## Read more

- `AGENTS.md` in this folder: the conventions of the app.
- The root `CLAUDE.md`: the rules for the whole codebase (typed Supabase helpers, i18n, dialogs,
  responsive).
- The root `CONTRIBUTING.md`: running from source, checks, pull requests.
