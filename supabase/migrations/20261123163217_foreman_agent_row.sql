-- The Chief of Staff becomes a coworker of its own kind: one `agents` row per workspace, outside every
-- Box, and conversations each member holds with it alone. Nothing reads the row or a private session
-- yet: the hub moves its readers onto them in the pull requests that follow.

do $$ begin
    create type public.agent_kind as enum ('coworker', 'foreman');
exception when duplicate_object then null;
end $$;

alter table public.agents add column if not exists kind public.agent_kind not null default 'coworker';

-- A coworker sits in a Box, the Chief of Staff in none: the composite foreign key to `spaces` lets a
-- null through (MATCH SIMPLE), this keeps every other row where it was.
alter table public.agents alter column space_id drop not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'agents_box_by_kind') then
        alter table public.agents add constraint agents_box_by_kind check ((kind = 'foreman') = (space_id is null));
    end if;
end $$;

create unique index if not exists agents_foreman_per_workspace_idx on public.agents (workspace_id) where kind = 'foreman';

-- Its row is not the first coworker the getting-started checklist waits for.
drop trigger if exists getting_started_on_agent on public.agents;
create trigger getting_started_on_agent
    after insert on public.agents
    for each row
    when (new.kind = 'coworker')
    execute function public.getting_started_on_agent();

-- One per workspace, named as the workspace already calls it. No handle: a coworker may hold any.
insert into public.agents (workspace_id, kind, space_id, name, engine_agent_id)
select w.id,
       'foreman',
       null,
       coalesce(nullif(left(btrim(o.answers #>> '{foreman,name}'), 24), ''), 'Chief of Staff'),
       'foreman'
from public.workspaces w
left join public.workspace_onboarding o on o.workspace_id = w.id
on conflict do nothing;

-- A conversation with an owner is that member's alone: the Chief of Staff talks to each member with
-- their own rights. Null keeps a conversation shared by everyone who sees the coworker.
alter table public.sessions add column if not exists owner_user_id uuid references public.users(id) on delete cascade;

create index if not exists sessions_owner_idx on public.sessions (owner_user_id) where owner_user_id is not null;

-- One General per coworker, or one per member for a coworker whose conversations are private.
create unique index if not exists sessions_general_shared_idx on public.sessions (agent_id) where kind = 'general' and owner_user_id is null;
create unique index if not exists sessions_general_per_member_idx on public.sessions (agent_id, owner_user_id) where kind = 'general' and owner_user_id is not null;
drop index if exists public.sessions_general_per_agent_idx;

-- Every member reaches the Chief of Staff of their workspace. `unseen_runs` reads through this function
-- and keeps working unchanged: a private conversation's notifications are addressed to its owner only.
create or replace function public.visible_agent_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
    return query
    select a.id
    from public.workspace_members wm
    join public.agents a on a.workspace_id = wm.workspace_id
    where wm.user_id = auth.uid() and wm.role = 'admin' and a.space_id is not null
    union all
    select a.id
    from public.workspace_members wm
    join public.agents a on a.workspace_id = wm.workspace_id
    join public.spaces s on s.id = a.space_id
    where wm.user_id = auth.uid() and wm.role <> 'admin'
      and (
          (wm.box_scope = 'all' and s.visibility = 'workspace')
          or exists (select 1 from public.space_members m where m.space_id = s.id and m.user_id = wm.user_id)
      )
    union all
    select a.id
    from public.workspace_members wm
    join public.agents a on a.workspace_id = wm.workspace_id and a.kind = 'foreman'
    where wm.user_id = auth.uid();
end
$$;

-- A private conversation is its owner's alone, whatever they see of the coworker. The policies of
-- `session_participants` and `session_reads` read `sessions` under these, so they follow.
drop policy if exists "Users can view sessions for their agents" on public.sessions;
create policy "Users can view sessions for their agents" on public.sessions for select
    using (agent_id in (select public.visible_agent_ids()) and (owner_user_id is null or owner_user_id = auth.uid()));
drop policy if exists "Users can insert sessions for their agents" on public.sessions;
create policy "Users can insert sessions for their agents" on public.sessions for insert
    with check (agent_id in (select public.visible_agent_ids()) and (owner_user_id is null or owner_user_id = auth.uid()));
drop policy if exists "Users can update sessions for their agents" on public.sessions;
create policy "Users can update sessions for their agents" on public.sessions for update
    using (agent_id in (select public.visible_agent_ids()) and (owner_user_id is null or owner_user_id = auth.uid()))
    with check (agent_id in (select public.visible_agent_ids()) and (owner_user_id is null or owner_user_id = auth.uid()));
drop policy if exists "Users can delete sessions for their agents" on public.sessions;
create policy "Users can delete sessions for their agents" on public.sessions for delete
    using (agent_id in (select public.visible_agent_ids()) and (owner_user_id is null or owner_user_id = auth.uid()));
