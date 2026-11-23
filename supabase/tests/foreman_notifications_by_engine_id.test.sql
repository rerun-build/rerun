-- The notifications of the Chief of Staff that name it only by its engine id (migration
-- 20261123173512_foreman_notifications_by_engine_id): written before it had a row, or left without one,
-- they reach only the members they are addressed to. Runs with `pnpm exec supabase test db`; everything
-- is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000f201', 'cose-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000f202', 'cose-member@rerun.test');
insert into public.workspaces (id, icon_url, name) values (992002, '', 'CoS notices by engine id');
insert into public.users (id, workspace_id)
select id, 992002 from auth.users where email like 'cose-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role, box_scope) values
    ('00000000-0000-0000-0000-00000000f201', 992002, 'admin', 'all'),
    ('00000000-0000-0000-0000-00000000f202', 992002, 'member', 'all');
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end, visibility) values
    ('00000000-0000-0000-0000-0000000e5101', 992002, 'Open', 0, 0, 3, 3, 'workspace');
insert into public.agents (id, workspace_id, space_id, name, col, "row") values
    ('00000000-0000-0000-0000-0000000e6101', 992002, '00000000-0000-0000-0000-0000000e5101', 'open-agent', 1, 1);
insert into public.agents (id, workspace_id, kind, space_id, name, engine_agent_id) values
    ('00000000-0000-0000-0000-0000000e6102', 992002, 'foreman', null, 'Chief of Staff', 'foreman');
insert into public.notifications (workspace_id, agent_id, engine_agent_id, space_id, message, recipients) values
    (992002, null, 'foreman', null, 'old-notice', '{"00000000-0000-0000-0000-00000000f202": "mine"}'),
    (992002, null, 'foreman', null, 'orphan-notice', '{}'),
    (992002, null, null, null, 'workspace-wide', '{}');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000f202');
select is((select count(*)::int from public.notifications where message = 'old-notice'), 1, 'the member reads the notice it was addressed to');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f201');
select is((select count(*)::int from public.notifications where message = 'old-notice'), 0, 'the admin does not read a notice addressed to a member');
select is((select count(*)::int from public.notifications where message = 'orphan-notice'), 0, 'nobody reads one addressed to nobody');
select is((select count(*)::int from public.notifications where message = 'workspace-wide'), 1, 'a notification of the workspace still reaches every member');

select * from finish();
rollback;
