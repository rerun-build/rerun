-- The Chief of Staff writes to one member: a notification of its own (engine_agent_id 'foreman', no
-- coworker, no Box) is read by its recipients only, where any member could read it until now, the
-- proposal it carries included, and receive it in real time.
drop policy if exists notifications_select_workspace_members on public.notifications;
create policy notifications_select_workspace_members on public.notifications for select to authenticated
    using (
        workspace_id in (select public.current_workspace_ids())
        and (agent_id is null or agent_id in (select public.visible_agent_ids()))
        and (space_id is null or space_id in (select public.visible_space_ids()))
        and (engine_agent_id is distinct from 'foreman' or recipients ? (auth.uid())::text)
    );
