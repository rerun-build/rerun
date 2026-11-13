-- The foreman now keeps, like a coworker, one main conversation per member, General, and threads
-- beside it. Until now "New task" only left the previous conversation behind, unreachable: the
-- column reopened on the latest one. Only the engine's foreman has threads; the onboarding's, on
-- the hub, stays a single conversation its phases read from start to end.
--
-- `status` is what a thread shows in General (working, awaiting an answer, failed), written by the
-- hub when a message goes out and by the engine's notifications when the run stops.
alter table public.foreman_conversations
    add column if not exists kind public.session_kind not null default 'thread',
    add column if not exists first_message text,
    add column if not exists status public.session_status not null default 'idle';

-- The conversation each member sees today becomes their General, the ones "New task" left behind
-- become its threads. Re-runnable: a member who already has a General is left alone.
update public.foreman_conversations conversation
set kind = 'general'
from (
    select distinct on (workspace_id, user_id) id, workspace_id, user_id
    from public.foreman_conversations
    where backend = 'engine'
    order by workspace_id, user_id, updated_at desc
) latest
where conversation.id = latest.id
  and not exists (
      select 1
      from public.foreman_conversations general
      where general.workspace_id = latest.workspace_id
        and general.user_id = latest.user_id
        and general.backend = 'engine'
        and general.kind = 'general'
  );

create unique index if not exists foreman_conversations_general_per_member_idx
    on public.foreman_conversations (workspace_id, user_id)
    where kind = 'general' and backend = 'engine';

-- The column follows its threads live. The select-own policy already keeps each member to theirs.
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'foreman_conversations'
    ) then
        alter publication supabase_realtime add table public.foreman_conversations;
    end if;
end $$;
