-- The team of an organization, in one of its clients' workspaces, watches the board and is never seen
-- on it: neither a cursor nor a presence of theirs is accepted on the channel, whatever their browser
-- sends. Reading stays open to them.
drop policy if exists "Members send the cursors of their workspace" on realtime.messages;
create policy "Members send the cursors of their workspace" on realtime.messages
    for insert to authenticated
    with check (
        extension in ('broadcast', 'presence')
        and realtime.topic() in (
            select 'cursors:' || member.workspace_id
            from public.workspace_members member
            where member.user_id = auth.uid() and not member.organization_staff
        )
    );
