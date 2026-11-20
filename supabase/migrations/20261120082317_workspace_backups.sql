-- The nightly backup of a paying workspace's engine data-dir, in a bucket of its own with Object Lock.
-- Apart from workspace_archives on purpose: the pause, the sandbox lock, the teardown and the admin
-- read "the latest archive" there, and a backup taken every night is not one. The object lives in the
-- bucket; this row is what the hub knows about it. Service-role only: a member never sees a backup.

create type public.workspace_backup_status as enum ('running', 'done', 'skipped', 'failed');

-- 'weekly' is the backup of the night from Saturday to Sunday, kept four weeks instead of one.
create type public.workspace_backup_kind as enum ('daily', 'weekly');

-- Where the last restore of a backup stands. The backup itself stays good whatever it says.
create type public.workspace_backup_restore_status as enum ('restoring', 'restored', 'failed');

create table public.workspace_backups (
    id uuid primary key default gen_random_uuid(),
    workspace_id bigint not null references public.workspaces (id) on delete cascade,
    -- 'skipped' is a night the box was in the middle of a run: nothing was stopped, the next pass of
    -- the sweep tries again. 'failed' is a backup that started and did not complete.
    status public.workspace_backup_status not null default 'running',
    kind public.workspace_backup_kind not null default 'daily',
    object_key text not null unique,
    -- Of the encrypted object, as uploaded and read back.
    bytes bigint,
    sha256 text,
    -- The data-dir on disk before compression, to refuse a restore onto a box too small for it.
    raw_bytes bigint,
    data_version integer,
    engine_commit text,
    -- By name as well as id: a host row can be deleted, and a lost host is when a backup matters.
    source_host_id uuid references public.engine_hosts (id) on delete set null,
    source_host_name text not null,
    source_box text not null,
    -- The time zone of the box's first member, read off the box during the backup, so the next
    -- backups land in that workspace's night.
    timezone text,
    error_message text,
    -- The last time an admin brought this backup back, onto the workspace's box or a fresh one.
    restore_status public.workspace_backup_restore_status,
    restore_started_at timestamptz,
    restored_at timestamptz,
    restored_to_instance_id uuid references public.engine_pool (id) on delete set null,
    restore_error text,
    created_at timestamptz not null default now(),
    finished_at timestamptz,
    -- The bucket's lifecycle rule deletes the object after this; the row mirrors it.
    expires_at timestamptz
);

create index workspace_backups_workspace_idx on public.workspace_backups (workspace_id, created_at desc);

-- One backup at a time per workspace: two would each stop the engine under the other.
create unique index workspace_backups_one_running_per_workspace_idx
    on public.workspace_backups (workspace_id)
    where status = 'running';

alter table public.workspace_backups enable row level security;
-- RLS does not cover truncate, and Supabase's default privileges hand it to anon on every new table.
revoke all on table public.workspace_backups from anon, authenticated;
grant select, insert, update, delete on table public.workspace_backups to service_role;
