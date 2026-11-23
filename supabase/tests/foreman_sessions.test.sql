-- The notifications of the Chief of Staff (migration 20261123171845_foreman_sessions): what a run of a
-- private conversation said reaches only the members it is addressed to. Runs with
-- `pnpm exec supabase test db` on the local stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(5);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000f101', 'cosn-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000f102', 'cosn-member@rerun.test');
insert into public.workspaces (id, icon_url, name) values (992001, '', 'CoS notifications');
insert into public.users (id, workspace_id)
select id, 992001 from auth.users where email like 'cosn-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role, box_scope) values
    ('00000000-0000-0000-0000-00000000f101', 992001, 'admin', 'all'),
    ('00000000-0000-0000-0000-00000000f102', 992001, 'member', 'all');
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end, visibility) values
    ('00000000-0000-0000-0000-0000000e5001', 992001, 'Open', 0, 0, 3, 3, 'workspace');
insert into public.agents (id, workspace_id, space_id, name, col, "row") values
    ('00000000-0000-0000-0000-0000000e6001', 992001, '00000000-0000-0000-0000-0000000e5001', 'open-agent', 1, 1);
insert into public.agents (id, workspace_id, kind, space_id, name, engine_agent_id) values
    ('00000000-0000-0000-0000-0000000e6002', 992001, 'foreman', null, 'Chief of Staff', 'foreman');
insert into public.notifications (workspace_id, agent_id, space_id, message, recipients) values
    (992001, '00000000-0000-0000-0000-0000000e6002', null, 'for-member', '{"00000000-0000-0000-0000-00000000f102": "mine"}'),
    (992001, '00000000-0000-0000-0000-0000000e6002', null, 'for-nobody', '{}'),
    (992001, '00000000-0000-0000-0000-0000000e6001', '00000000-0000-0000-0000-0000000e5001', 'coworker-news', '{}'),
    (992001, null, null, 'workspace-wide', '{}');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select ok((select count(*) from public.notifications where message = 'for-member') = 1, 'the member reads what the Chief of Staff told them');
select set_eq($$ select message from public.notifications where workspace_id = 992001 $$, array['for-member', 'coworker-news', 'workspace-wide'], 'and the news of the coworkers they see, as before');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f101');
select is((select count(*)::int from public.notifications where message = 'for-member'), 0, 'the admin does not read what it told a member');
select is((select count(*)::int from public.notifications where message = 'for-nobody'), 0, 'nobody reads what it told nobody');
select is((select count(*)::int from public.notifications where message = 'coworker-news'), 1, 'a coworker''s news still reaches every member who sees it');

select * from finish();
rollback;
