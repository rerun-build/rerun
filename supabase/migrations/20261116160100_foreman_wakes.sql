-- The Chief of Staff wakes up on its own: never in the night of the member it speaks to, whose time
-- zone the browser and the phone app report, rarely in a workspace nobody opened for a week, and only
-- in a workspace that keeps it on.
alter table public.users add column if not exists timezone text;
alter table public.users add column if not exists last_active_at timestamptz;
alter table public.workspaces add column if not exists assistant_proactive boolean not null default true;
