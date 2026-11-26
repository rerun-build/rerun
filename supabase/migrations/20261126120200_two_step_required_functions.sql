-- Two-step verification (RER-379), in the functions the policies cannot reach. A security definer
-- function reads its tables as their owner, so the restrictive two_step_required policies of
-- 20261126120100 never see it: called over PostgREST with a token that still owes its second step,
-- each of these would hand back the account's workspaces, Boxes and coworkers, and unseen_runs()
-- (which asks current_workspace_ids()) the titles and last messages of its runs. Each one is the
-- same as before, with the condition of the policies next to its `auth.uid()`; manageable_agent_ids()
-- reads through manageable_space_ids() and unseen_runs() through current_workspace_ids(), so both are
-- left as they are. The service role and
-- the engine carry no `two_step` in their token, so nothing changes for them.
-- A new security definer function that authenticated may call carries the same condition
-- (apps/ui/lib/auth/two-step/rls.test.ts checks it).

create or replace function public.current_workspace_ids()
returns setof bigint
language sql
stable
security definer
set search_path to 'public'
as $$
    select workspace_id from public.workspace_members
    where user_id = auth.uid()
      and (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
$$;

create or replace function public.current_admin_workspace_ids()
returns setof bigint
language sql
stable
security definer
set search_path to 'public'
as $$
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role = 'admin'
      and (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
$$;

create or replace function public.visible_space_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
    if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') = 'true' and coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
        return;
    end if;
    return query
    select s.id
    from public.spaces s
    join public.workspace_members wm on wm.workspace_id = s.workspace_id and wm.user_id = auth.uid()
    where wm.role = 'admin'
       or exists (select 1 from public.space_members m where m.space_id = s.id and m.user_id = auth.uid())
       or (wm.box_scope = 'all' and s.visibility = 'workspace');
end
$$;

create or replace function public.manageable_space_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
    select s.id from public.spaces s
    where s.workspace_id in (select public.current_admin_workspace_ids())
    union
    select m.space_id from public.space_members m
    where m.user_id = auth.uid() and m.access = 'manage'
      and (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
$$;

create or replace function public.visible_agent_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
    if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') = 'true' and coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
        return;
    end if;
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
      )
    union all
    select a.id
    from public.workspace_members wm
    join public.agents a on a.workspace_id = wm.workspace_id and a.kind = 'foreman'
    where wm.user_id = auth.uid();
end
$$;
