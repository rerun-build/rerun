-- A notification of the Chief of Staff written before it had a row, or whose row went away
-- (`agent_id` is set null on delete), still names it by its engine id: it reaches only the members
-- it is addressed to, like the ones under its row (20261123171845).
drop policy if exists notifications_select_workspace_members on public.notifications;
create policy notifications_select_workspace_members on public.notifications for select to authenticated
    using (
        workspace_id in (select public.current_workspace_ids())
        and (agent_id is null or agent_id in (select public.visible_agent_ids()))
        and (space_id is null or space_id in (select public.visible_space_ids()))
        and (
            recipients ? auth.uid()::text
            or (
                engine_agent_id is distinct from 'foreman'
                and not exists (select 1 from public.agents a where a.id = notifications.agent_id and a.kind = 'foreman')
            )
        )
    );
