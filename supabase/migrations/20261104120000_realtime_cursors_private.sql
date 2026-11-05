-- The team cursors of a board travel on the broadcast channel `cursors:<workspace id>`. The channel
-- is now private: Realtime lets a client join, send and track presence only when these policies
-- accept the topic for the caller. Without a policy a private channel is refused to everyone, so
-- the app must ship with this migration applied. Row level security is already on for
-- `realtime.messages` (Supabase owns the table; `postgres` may add policies, not alter it).

-- The topic is matched as text against the caller's workspaces, so a forged topic never reaches a
-- cast that could fail. `current_workspace_ids()` reads `workspace_members` as its definer.
drop policy if exists "Members read the cursors of their workspace" on realtime.messages;
create policy "Members read the cursors of their workspace" on realtime.messages
    for select to authenticated
    using (
        extension in ('broadcast', 'presence')
        and realtime.topic() in (select 'cursors:' || workspace_id from public.current_workspace_ids() as workspace_id)
    );

drop policy if exists "Members send the cursors of their workspace" on realtime.messages;
create policy "Members send the cursors of their workspace" on realtime.messages
    for insert to authenticated
    with check (
        extension in ('broadcast', 'presence')
        and realtime.topic() in (select 'cursors:' || workspace_id from public.current_workspace_ids() as workspace_id)
    );

grant execute on function public.current_workspace_ids() to authenticated;
