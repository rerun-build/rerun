-- The Chief of Staff becomes a row of `agents`, beside the coworkers, in a later release. This one
-- only prepares the table and the readers: every row that exists is a coworker (the default), no
-- Chief of Staff row is written yet, so nothing changes on screen.
--
-- What sets it apart, and why every reader that lists the coworkers of a workspace now filters on
-- `kind = 'coworker'`: it has no Box (`space_id` null), it is never counted against the plan, never
-- disabled, never put on the board, and there is exactly one per workspace.
--
-- Safe to push before its code and re-runnable. The constant default is metadata only, and the
-- check is validated apart so the table is not locked while it is read.
do $$ begin
    create type public.agent_kind as enum ('coworker', 'foreman');
exception when duplicate_object then null;
end $$;

alter table public.agents add column if not exists kind public.agent_kind not null default 'coworker';

alter table public.agents alter column space_id drop not null;

do $$ begin
    alter table public.agents add constraint agents_box_by_kind_check check ((kind = 'foreman') = (space_id is null)) not valid;
exception when duplicate_object then null;
end $$;
alter table public.agents validate constraint agents_box_by_kind_check;

create unique index if not exists agents_foreman_per_workspace_idx on public.agents (workspace_id) where kind = 'foreman';

-- "First coworker" is the coworker someone hired, not the Chief of Staff every workspace is given.
drop trigger if exists getting_started_on_agent on public.agents;
create trigger getting_started_on_agent
    after insert on public.agents
    for each row
    when (new.kind = 'coworker')
    execute function public.getting_started_on_agent();

-- The Simple view lists the coworkers; the Chief of Staff has its own column.
create or replace function public.coworker_previews(p_workspace_id integer)
returns table (agent_id uuid, session_id uuid, title text, status public.session_status, updated_at timestamptz, last_message text, last_message_from text, last_message_at timestamptz, last_message_author_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
    select a.id, s.id, s.title, s.status, s.updated_at, s.last_message, s.last_message_from, s.last_message_at, s.last_message_author_id
    from public.agents a
    left join lateral (
        select s.id, s.title, s.status, s.updated_at, s.last_message, s.last_message_from, s.last_message_at, s.last_message_author_id
        from public.sessions s
        where s.agent_id = a.id
        order by s.updated_at desc
        limit 1
    ) s on true
    where a.workspace_id = p_workspace_id
      and a.kind = 'coworker'
$$;
