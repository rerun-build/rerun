-- The computers people linked to a workspace from the desktop app, for its coworkers to run commands,
-- jobs and files on. Each link holds a token the app keeps; only its sha256 is stored here. Members
-- read the list, every write goes through the service role. What the coworkers may do on a computer
-- (its rules) lives on the workspace's engine, where it is enforced.
create table if not exists public.remote_computers (
    id uuid primary key default gen_random_uuid(),
    workspace_id bigint not null references public.workspaces (id) on delete cascade,
    name text not null check (char_length(name) between 1 and 100),
    -- `#handle` in a message. Kept when the computer is renamed, so a schedule that names it still does.
    handle text not null check (handle ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'),
    os text not null check (os in ('mac', 'win', 'linux')),
    arch text not null default '' check (char_length(arch) <= 32),
    hostname text not null default '' check (char_length(hostname) <= 255),
    app_version text not null default '' check (char_length(app_version) <= 64),
    token_hash text not null unique,
    linked_by uuid references auth.users (id) on delete set null,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists remote_computers_workspace_id_idx on public.remote_computers (workspace_id);

-- A handle names one live computer of the workspace; an unlinked one gives its handle back.
create unique index if not exists remote_computers_workspace_handle_idx on public.remote_computers (workspace_id, handle) where revoked_at is null;

alter table public.remote_computers enable row level security;

revoke all on table public.remote_computers from anon, authenticated;
-- The token hash authenticates the app, so it stays server-side.
grant select (id, workspace_id, name, handle, os, arch, hostname, app_version, linked_by, last_seen_at, revoked_at, created_at, updated_at) on table public.remote_computers to authenticated;
grant all on table public.remote_computers to service_role;

create policy "remote_computers_select_workspace_members"
    on public.remote_computers
    for select
    to authenticated
    using (workspace_id in (select workspace_members.workspace_id from public.workspace_members where workspace_members.user_id = auth.uid()));
