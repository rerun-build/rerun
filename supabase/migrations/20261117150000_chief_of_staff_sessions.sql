-- The Chief of Staff gets a row of `agents` (kind `foreman`, no Box, engine id `foreman`), and its
-- conversations move from `foreman_conversations` to `sessions`, beside the coworkers'. What stays
-- its own: every member talks to it with their own rights, so each conversation has an owner
-- (`sessions.owner_id`) and each member their own General.
--
-- The previous release taught every reader of `agents` to list coworkers only, so the rows written
-- here are never counted, disabled or shown on the board by a hub still running that code.
--
-- `foreman_conversations` stays and is kept in step both ways until a later release drops it: a hub
-- still on the previous code during the deploy writes there, an app build older than this one reads
-- there, and a hub rolled back to the previous release finds every conversation it knows. Its
-- conversations from the onboarding (`backend = 'hub'`, a transcript kept on the hub) stay there.
--
-- Re-runnable: every row is written once, keeping its id.

alter table public.sessions add column if not exists owner_id uuid references public.users(id) on delete cascade;

-- The member's list of their own conversations, latest first.
create index if not exists sessions_owner_updated_idx on public.sessions (agent_id, owner_id, updated_at desc) where owner_id is not null;

-- One General per coworker, and one per member for the Chief of Staff. The new indexes are built
-- before the old one goes, so no instant runs without the rule.
create unique index if not exists sessions_general_per_coworker_idx on public.sessions (agent_id) where kind = 'general' and owner_id is null;
create unique index if not exists sessions_general_per_owner_idx on public.sessions (agent_id, owner_id) where kind = 'general' and owner_id is not null;
drop index if exists public.sessions_general_per_agent_idx;

-- The Chief of Staff of a workspace, written the first time something needs it rather than for every
-- workspace: an anonymous visitor gets a workspace too, and most never reach the Chief of Staff.
create or replace function public.ensure_foreman_agent(p_workspace_id bigint)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_id uuid;
begin
    select id into v_id from public.agents where workspace_id = p_workspace_id and kind = 'foreman';
    if v_id is not null then
        return v_id;
    end if;
    insert into public.agents (workspace_id, kind, name, engine_agent_id)
    values (p_workspace_id, 'foreman', 'Chief of Staff', 'foreman')
    on conflict (workspace_id) where kind = 'foreman' do nothing
    returning id into v_id;
    if v_id is null then
        select id into v_id from public.agents where workspace_id = p_workspace_id and kind = 'foreman';
    end if;
    return v_id;
end
$$;

revoke all on function public.ensure_foreman_agent(bigint) from public, anon, authenticated;
grant execute on function public.ensure_foreman_agent(bigint) to service_role;

-- The Chief of Staff of the workspaces the caller belongs to. A member who left reads none of its
-- conversations any more, even the ones they own.
create or replace function public.member_foreman_agent_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
    select a.id from public.agents a where a.kind = 'foreman' and a.workspace_id in (select public.current_workspace_ids())
$$;

revoke all on function public.member_foreman_agent_ids() from public;
grant execute on function public.member_foreman_agent_ids() to authenticated;
grant execute on function public.member_foreman_agent_ids() to service_role;

-- A member reads and follows their own conversations with the Chief of Staff, live. Writing them
-- stays with the hub, which holds the rights of whoever is talking.
drop policy if exists "Members read their own Chief of Staff conversations" on public.sessions;
create policy "Members read their own Chief of Staff conversations" on public.sessions for select to authenticated
    using (owner_id = auth.uid() and agent_id in (select public.member_foreman_agent_ids()));

-- A conversation of `foreman_conversations` may have no title yet; one of `sessions` always has the
-- one a coworker's would: General, or its opening line until a title is generated.
create or replace function public.foreman_session_title(p_title text, p_kind public.session_kind, p_first_message text)
returns text
language sql
immutable
as $$
    select coalesce(p_title, case when p_kind = 'general' then 'General' else coalesce(nullif(left(p_first_message, 50), ''), 'New conversation') end)
$$;

-- Every engine conversation, with its id, its owner and where it stands.
insert into public.sessions (id, agent_id, owner_id, engine_session_id, title, kind, status, first_message, source, created_at, updated_at)
select
    fc.id,
    public.ensure_foreman_agent(fc.workspace_id),
    fc.user_id,
    fc.engine_session_id,
    public.foreman_session_title(fc.title, fc.kind, fc.first_message),
    fc.kind,
    fc.status,
    fc.first_message,
    'dashboard',
    fc.created_at,
    fc.updated_at
from public.foreman_conversations fc
where fc.backend = 'engine' and fc.engine_session_id is not null
on conflict do nothing;

-- A vote on a reply of the Chief of Staff now names its conversation like a coworker's. It keeps no
-- coworker (`agent_id`): reaching it is owning the conversation, not reaching a Box.
update public.message_feedback f
set session_id = f.foreman_conversation_id
from public.sessions s
where s.id = f.foreman_conversation_id
  and f.session_id is null
  and not exists (select 1 from public.message_feedback other where other.session_id = f.foreman_conversation_id and other.message_id = f.message_id);

-- Kept in step both ways while both tables live. A write made by one of these triggers does not
-- come back through the other (`pg_trigger_depth`).
create or replace function public.foreman_conversation_to_session()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if pg_trigger_depth() > 1 then
        return null;
    end if;
    if tg_op = 'DELETE' then
        delete from public.sessions where id = old.id and owner_id is not null;
        return null;
    end if;
    if new.backend <> 'engine' or new.engine_session_id is null then
        return null;
    end if;
    insert into public.sessions (id, agent_id, owner_id, engine_session_id, title, kind, status, first_message, source, created_at, updated_at)
    values (new.id, public.ensure_foreman_agent(new.workspace_id), new.user_id, new.engine_session_id, public.foreman_session_title(new.title, new.kind, new.first_message), new.kind, new.status, new.first_message, 'dashboard', new.created_at, new.updated_at)
    on conflict (id) do update set
        title = excluded.title,
        kind = excluded.kind,
        status = excluded.status,
        first_message = excluded.first_message
    where public.sessions.owner_id is not null;
    return null;
end
$$;

drop trigger if exists foreman_conversation_to_session on public.foreman_conversations;
create trigger foreman_conversation_to_session
    after insert or update or delete on public.foreman_conversations
    for each row execute function public.foreman_conversation_to_session();

create or replace function public.session_to_foreman_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_workspace_id bigint;
begin
    if pg_trigger_depth() > 1 then
        return null;
    end if;
    if tg_op = 'DELETE' then
        if old.owner_id is not null then
            delete from public.foreman_conversations where id = old.id;
        end if;
        return null;
    end if;
    if new.owner_id is null then
        return null;
    end if;
    select workspace_id into v_workspace_id from public.agents where id = new.agent_id and kind = 'foreman';
    if v_workspace_id is null then
        return null;
    end if;
    insert into public.foreman_conversations (id, workspace_id, user_id, backend, engine_session_id, title, kind, status, first_message, created_at, updated_at)
    values (new.id, v_workspace_id, new.owner_id, 'engine', new.engine_session_id, new.title, new.kind, new.status, new.first_message, new.created_at, new.updated_at)
    on conflict (id) do update set
        title = excluded.title,
        kind = excluded.kind,
        status = excluded.status,
        first_message = excluded.first_message,
        updated_at = excluded.updated_at;
    return null;
end
$$;

drop trigger if exists session_to_foreman_conversation on public.sessions;
create trigger session_to_foreman_conversation
    after insert or update or delete on public.sessions
    for each row execute function public.session_to_foreman_conversation();

revoke all on function public.foreman_conversation_to_session() from public, anon, authenticated;
revoke all on function public.session_to_foreman_conversation() from public, anon, authenticated;
