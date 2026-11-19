-- The weekly Rewind: a story of what a workspace's agents did during the last Monday-to-Sunday UTC
-- week. The detail lives on each agent's engine, which may be switched off by the time someone
-- opens the story, so the weekly sweep computes it once and freezes it here.

create table public.workspace_rewinds (
    id uuid primary key default gen_random_uuid(),
    workspace_id bigint not null references public.workspaces(id) on delete cascade,
    week_start date not null,
    -- A RewindPayload from @moldwright/contracts, versioned by its own `version` field.
    payload jsonb not null,
    created_at timestamptz not null default now(),
    unique (workspace_id, week_start)
);

create index workspace_rewinds_recent_idx on public.workspace_rewinds (workspace_id, week_start desc);

alter table public.workspace_rewinds enable row level security;
revoke all on table public.workspace_rewinds from anon, authenticated;
grant select on table public.workspace_rewinds to authenticated;

create policy "workspace_rewinds_select_workspace_members"
    on public.workspace_rewinds
    for select
    to authenticated
    using (workspace_id in (select workspace_members.workspace_id from public.workspace_members where workspace_members.user_id = auth.uid()));

-- Who already watched a given Rewind: the story opens by itself once per person, not per workspace.
create table public.workspace_rewind_views (
    rewind_id uuid not null references public.workspace_rewinds(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    viewed_at timestamptz not null default now(),
    primary key (rewind_id, user_id)
);

alter table public.workspace_rewind_views enable row level security;
revoke all on table public.workspace_rewind_views from anon, authenticated;
grant select, insert on table public.workspace_rewind_views to authenticated;

create policy "workspace_rewind_views_select_own"
    on public.workspace_rewind_views
    for select
    to authenticated
    using (user_id = auth.uid());

create policy "workspace_rewind_views_insert_own"
    on public.workspace_rewind_views
    for insert
    to authenticated
    with check (
        user_id = auth.uid()
        and rewind_id in (
            select workspace_rewinds.id from public.workspace_rewinds
            where workspace_rewinds.workspace_id in (select workspace_members.workspace_id from public.workspace_members where workspace_members.user_id = auth.uid())
        )
    );
