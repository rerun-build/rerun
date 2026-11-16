# @rerun/db

The typed access to Rerun's Supabase database:

| Entry point | What it holds |
| --- | --- |
| `@rerun/db/types` | `Database`, the types of every table, view and function (`src/database.types.ts`) |
| `@rerun/db/helpers` | the typed read helpers: `selectSingle`, `selectMaybeSingle`, `selectMany`, `selectAll`, `selectCount`, and `selectSingleWithJoins`, `selectMaybeSingleWithJoins`, `selectManyWithJoins` |
| `@rerun/db/client` | `createPublicClient()` and `createServiceRoleClient()` for server code outside a request |
| `@rerun/db` | all of the above, plus the storage layout of the experts' images (`src/experts-storage.ts`) |

## Who imports it

`apps/ui`, mostly through two re-exports: `@/app/api/database.types` and `@/supabase/supabase-helpers`.
`apps/mobile` imports the types only, for its own client.

## The types follow the migrations

The schema is `supabase/migrations/`, one file per change (`pnpm db:new <name>`). A migration that
changes a table changes `src/database.types.ts` in the same pull request: regenerate it from the local
database once the migration has run (`npx supabase gen types typescript --local`).

## Check it

```bash
pnpm --filter @rerun/db ts-check
pnpm --filter rerun test supabase/supabase-helpers.test.ts   # the helpers' tests live in the hub
```

## Rules

The root `CLAUDE.md` ("Supabase") has them in full:

- Every read goes through the helpers, never a raw `.from(table).select(...)`. Filters are objects
  (`{ id }`, `{ status: 'published' }`, `{ id: { neq: current } }`, an array for `IN`); a null is
  `{ isNull: true }`.
- Writes stay raw `.from(...)` and carry their payload type
  (`.update<Database['public']['Tables']['agents']['Update']>(...)`).
- Every client is built with `<Database>`, and a function taking one is typed `SupabaseClient<Database>`.
- A client made outside a browser turns off `autoRefreshToken`, as `src/client.ts` does: left on, its
  timer never stops and keeps the request that created it alive.
