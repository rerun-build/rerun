-- The Chief of Staff's conversations with the engine move to `sessions`, under the same ids, each one
-- owned by the member who holds it. `foreman_conversations` keeps being written beside them for the
-- builds of the app that still listen to it, and keeps the onboarding's conversations on the hub.

insert into public.sessions (id, agent_id, engine_session_id, title, status, kind, first_message, owner_user_id, source, created_at, updated_at)
select fc.id,
       a.id,
       fc.engine_session_id,
       case
           when fc.kind = 'general' then 'General'
           else coalesce(nullif(btrim(fc.title), ''), nullif(left(fc.first_message, 50), ''), 'New conversation')
       end,
       fc.status,
       fc.kind,
       fc.first_message,
       fc.user_id,
       'dashboard',
       fc.created_at,
       fc.updated_at
from public.foreman_conversations fc
join public.agents a on a.workspace_id = fc.workspace_id and a.kind = 'foreman'
where fc.backend = 'engine' and fc.engine_session_id is not null
on conflict do nothing;

-- What a run of a private conversation said is its owner's to read: the notifications of the Chief of
-- Staff reach only the members they are addressed to, like the conversations they come from.
drop policy if exists notifications_select_workspace_members on public.notifications;
create policy notifications_select_workspace_members on public.notifications for select to authenticated
    using (
        workspace_id in (select public.current_workspace_ids())
        and (agent_id is null or agent_id in (select public.visible_agent_ids()))
        and (space_id is null or space_id in (select public.visible_space_ids()))
        and (
            agent_id is null
            or recipients ? auth.uid()::text
            or not exists (select 1 from public.agents a where a.id = notifications.agent_id and a.kind = 'foreman')
        )
    );
