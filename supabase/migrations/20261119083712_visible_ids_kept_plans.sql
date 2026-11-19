-- The two functions every RLS policy of the board calls, and the policy of a read being recorded.
-- Same signatures, same rows: safe to push before or after the code.
--
-- Realtime checks every write to `sessions` against every subscriber's policy, and each check called
-- `visible_agent_ids()`, which walked the whole of `agents` (no index on `space_id`) and of `spaces`
-- (none on `workspace_id`), then planned its body again: 2 to 4 ms a check, measured on a copy of
-- production. In plpgsql the plan is kept by the session from one call to the next, and the coworkers
-- are reached through the caller's memberships and `agents (workspace_id)`: 0.1 to 0.4 ms.
create or replace function public.visible_space_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
    return query
    select s.id
    from public.spaces s
    join public.workspace_members wm on wm.workspace_id = s.workspace_id and wm.user_id = auth.uid()
    where wm.role = 'admin'
       or exists (select 1 from public.space_members m where m.space_id = s.id and m.user_id = auth.uid())
       or (wm.box_scope = 'all' and s.visibility = 'workspace');
end
$$;

-- An admin sees every coworker of the workspace: the foreign key (space_id, workspace_id) puts each
-- one in a Box of that workspace. Anyone else goes through the rule of `visible_space_ids()`.
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
      );
end
$$;

-- `visible_space_ids()` and the board's read of its Boxes start from a workspace.
create index if not exists spaces_workspace_idx on public.spaces (workspace_id);

-- `session_id in (select …)` built the list of every session the caller can see before looking for
-- one: 3,400 blocks and 30 to 70 ms to mark a conversation read. Looked up by its key: under 2 ms.
alter policy "Members record their own reads in their workspace sessions" on public.session_reads
    with check (
        user_id = auth.uid()
        and exists (select 1 from public.sessions s where s.id = session_reads.session_id and s.agent_id in (select public.visible_agent_ids()))
    );
