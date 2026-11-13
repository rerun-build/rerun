-- The Simple view lists each coworker with the last thing said in its latest conversation. The hub
-- sees both sides go by (the person's message in /api/chat, the start of the answer in the engine's
-- end-of-run notification) and keeps the latest one here, cut to one readable line. Conversations
-- older than these columns show their title until their next message.
alter table public.sessions add column if not exists last_message text;
alter table public.sessions add column if not exists last_message_from text;
alter table public.sessions add column if not exists last_message_at timestamptz;
-- The member who wrote it: the list says "You:" to them alone, not to their teammates.
alter table public.sessions add column if not exists last_message_author_id uuid references public.users(id) on delete set null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'sessions_last_message_from_check') then
        alter table public.sessions add constraint sessions_last_message_from_check check (last_message_from in ('user', 'agent'));
    end if;
end $$;

-- Each coworker's latest conversation is one probe of this index, whatever the size of its history.
create index if not exists sessions_agent_updated_idx on public.sessions (agent_id, updated_at desc);

-- One row per coworker of the workspace the caller reaches: its latest conversation, with its title,
-- its state and the last thing said in it. A coworker never talked to comes back with nulls. Security
-- invoker, so the policies on `agents` and `sessions` (the Boxes a member reaches) still apply.
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
$$;

revoke all on function public.coworker_previews(integer) from public, anon;
grant execute on function public.coworker_previews(integer) to authenticated;
