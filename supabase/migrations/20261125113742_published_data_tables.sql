-- The tables of the workspace's machine a published page may read live, and those it may also add
-- and edit rows in: [{ "database": "shared" | <agents.id>, "table": "clients", "grant": "read" | "write" }].
-- A table missing from the list is out of the page's reach.
alter table public.published_files
    add column data_tables jsonb not null default '[]'::jsonb check (jsonb_typeof(data_tables) = 'array');
