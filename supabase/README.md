# Database

The schema of Rerun lives in `migrations/`, and every change to it goes through a migration file.
The Supabase CLI owns this directory and runs from the repository root.

Not to be confused with `apps/ui/supabase/`, which holds the application clients and query helpers.

## Making a change

```bash
pnpm db:new add_agent_color     # creates migrations/<timestamp>_add_agent_color.sql
pnpm db:reset                   # replays every migration, then the seed, on the local stack
```

To apply the migrations to a hosted Supabase project:

```bash
npx supabase@^2.113.0 link --project-ref <your-project-ref>
npx supabase@^2.113.0 db push
```

## The baseline

`20260812121014_remote_schema.sql` is a dump of the schema taken on 12 August 2026, when the project
got a migration history. The files before it are empty on purpose and only keep the history aligned.

`20260812121424_column_level_grants.sql` restores the column-level privileges a schema dump leaves
out: they keep private columns of `experts`, `services`, `spaces` and `templates` away from `anon`
and `authenticated`. A new column that must be readable publicly is granted in its own migration.

`20260921120000_realtime_publication.sql` lists the tables the `supabase_realtime` publication
streams. A table a component subscribes to through `useRealtimeSubscription` has to be added there.

Some tables stay empty in a self-hosted install, because the code that fills them belongs to Rerun
Cloud: billing, paid apps, paid data, the machine pool and its hosts, workspace archives. They are
part of the schema all the same, so both run on the same migrations.

## The seed

`seed.sql` is loaded by `pnpm db:reset`. It carries the services catalog with its embeddings (so
search works without an embedding key), the alternatives between services, and the storage buckets.
It holds no user, workspace or credential: sign up through the app to get those.

## Local stack

`pnpm db:start` runs Supabase in Docker on ports 54420 to 54429, shifted off the defaults so it can
run beside another local Supabase project. `pnpm db:stop` releases them.

```bash
pnpm db:fresh:local     # starts the stack if needed, then replays migrations and seed
```
