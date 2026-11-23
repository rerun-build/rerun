-- A coworker acts with several accounts of a paid app: one row per account it holds, each with its own
-- wake-ups, instead of one per app. Safe to push before the code that reads it: no row changes, and the
-- code of the day writes at most one per coworker and app.
alter table public.app_connection_agents drop constraint app_connection_agents_pkey;
alter table public.app_connection_agents add primary key (agent_id, connection_id);

create index if not exists app_connection_agents_agent_app_idx on public.app_connection_agents (agent_id, app_slug);
