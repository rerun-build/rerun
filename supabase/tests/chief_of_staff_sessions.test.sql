-- The Chief of Staff's conversations in `sessions` (migration 20261117150000_chief_of_staff_sessions):
-- each member reads their own and nobody else's, keeps one General, and `foreman_conversations` follows
-- every change both ways while it lives. Runs with `pnpm exec supabase test db`; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(27);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000f101', 'cos-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000f102', 'cos-member@rerun.test'),
    ('00000000-0000-0000-0000-00000000f103', 'cos-outsider@rerun.test');
insert into public.workspaces (id, icon_url, name) values (990201, '', 'CoS test'), (990202, '', 'CoS other');
insert into public.users (id, workspace_id)
select id, case when email like 'cos-outsider%' then 990202 else 990201 end from auth.users where email like 'cos-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role) values
    ('00000000-0000-0000-0000-00000000f101', 990201, 'admin'),
    ('00000000-0000-0000-0000-00000000f102', 990201, 'member'),
    ('00000000-0000-0000-0000-00000000f103', 990202, 'admin');
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end) values
    ('00000000-0000-0000-0000-00000000f201', 990201, 'Box', 0, 0, 3, 3);
insert into public.agents (id, workspace_id, space_id, name) values
    ('00000000-0000-0000-0000-00000000f301', 990201, '00000000-0000-0000-0000-00000000f201', 'Scout');

create temporary table chief as select public.ensure_foreman_agent(990201) as id;
grant select on chief to authenticated;
select is(public.ensure_foreman_agent(990201), (select id from chief), 'the Chief of Staff is written once per workspace');
select is((select kind::text || ':' || coalesce(space_id::text, 'no box') || ':' || engine_agent_id from public.agents where id = (select id from chief)), 'foreman:no box:foreman', 'without a Box, under the engine id foreman');

insert into public.sessions (id, agent_id, owner_id, engine_session_id, kind, title) values
    ('00000000-0000-0000-0000-00000000f401', (select id from chief), '00000000-0000-0000-0000-00000000f101', 'cos-admin-general', 'general', 'General'),
    ('00000000-0000-0000-0000-00000000f402', (select id from chief), '00000000-0000-0000-0000-00000000f101', 'cos-admin-thread', 'thread', 'Hire a writer'),
    ('00000000-0000-0000-0000-00000000f403', (select id from chief), '00000000-0000-0000-0000-00000000f102', 'cos-member-general', 'general', 'General');
insert into public.sessions (id, agent_id, engine_session_id, kind) values
    ('00000000-0000-0000-0000-00000000f404', '00000000-0000-0000-0000-00000000f301', 'scout-general', 'general');

select throws_ok(
    $$ insert into public.sessions (agent_id, owner_id, engine_session_id, kind) select id, '00000000-0000-0000-0000-00000000f101', 'cos-admin-general-2', 'general' from chief $$,
    '23505', null, 'a member keeps one General with the Chief of Staff');
select throws_ok(
    $$ insert into public.sessions (agent_id, engine_session_id, kind) values ('00000000-0000-0000-0000-00000000f301', 'scout-general-2', 'general') $$,
    '23505', null, 'a coworker still keeps one General');

-- What the hub writes in `sessions` reaches `foreman_conversations`, for the builds that read it.
select results_eq(
    $$ select workspace_id, user_id::text, backend, engine_session_id, kind::text, title from public.foreman_conversations where id = '00000000-0000-0000-0000-00000000f402' $$,
    $$ values (990201::bigint, '00000000-0000-0000-0000-00000000f101', 'engine', 'cos-admin-thread', 'thread', 'Hire a writer') $$,
    'a conversation opened in sessions is copied to the old table');
select is((select count(*)::int from public.foreman_conversations where id = '00000000-0000-0000-0000-00000000f404'), 0, 'a coworker conversation is not');
update public.sessions set status = 'awaiting_question', title = 'Writer hired' where id = '00000000-0000-0000-0000-00000000f402';
select results_eq(
    $$ select status::text, title from public.foreman_conversations where id = '00000000-0000-0000-0000-00000000f402' $$,
    $$ values ('awaiting_question', 'Writer hired') $$,
    'its state and title follow');

-- What a hub still on the previous release writes in `foreman_conversations` reaches `sessions`.
insert into public.foreman_conversations (id, workspace_id, user_id, backend, engine_session_id, kind, status, first_message) values
    ('00000000-0000-0000-0000-00000000f405', 990201, '00000000-0000-0000-0000-00000000f102', 'engine', 'cos-member-thread', 'thread', 'working', 'Plan my week');
select results_eq(
    $$ select agent_id, owner_id::text, kind::text, status::text, title, source::text from public.sessions where id = '00000000-0000-0000-0000-00000000f405' $$,
    $$ select id, '00000000-0000-0000-0000-00000000f102', 'thread', 'working', 'Plan my week', 'dashboard' from chief $$,
    'a conversation opened by the previous release lands in sessions, named after its opening line');
update public.foreman_conversations set status = 'idle', title = 'Week planned' where id = '00000000-0000-0000-0000-00000000f405';
select results_eq(
    $$ select status::text, title from public.sessions where id = '00000000-0000-0000-0000-00000000f405' $$,
    $$ values ('idle', 'Week planned') $$,
    'and follows it');
insert into public.foreman_conversations (id, workspace_id, user_id, backend, messages) values
    ('00000000-0000-0000-0000-00000000f406', 990201, '00000000-0000-0000-0000-00000000f101', 'hub', '[]');
select is((select count(*)::int from public.sessions where id = '00000000-0000-0000-0000-00000000f406'), 0, 'an onboarding conversation on the hub stays out of sessions');
insert into public.foreman_conversations (id, workspace_id, user_id, backend, engine_session_id, kind) values
    ('00000000-0000-0000-0000-00000000f407', 990202, '00000000-0000-0000-0000-00000000f103', 'engine', 'cos-outsider-general', 'general');
select is((select count(*)::int from public.agents where workspace_id = 990202 and kind = 'foreman'), 1, 'the first conversation of a workspace writes its Chief of Staff');
delete from public.foreman_conversations where id = '00000000-0000-0000-0000-00000000f405';
select is((select count(*)::int from public.sessions where id = '00000000-0000-0000-0000-00000000f405'), 0, 'a conversation deleted in the old table goes from sessions');
delete from public.sessions where id = '00000000-0000-0000-0000-00000000f402';
select is((select count(*)::int from public.foreman_conversations where id = '00000000-0000-0000-0000-00000000f402'), 0, 'and the other way round');
insert into public.sessions (id, agent_id, owner_id, engine_session_id, kind, title) select '00000000-0000-0000-0000-00000000f402', id, '00000000-0000-0000-0000-00000000f101', 'cos-admin-thread', 'thread', 'Hire a writer' from chief;

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000f101');
select set_eq($$ select engine_session_id from public.sessions where agent_id = (select id from chief) $$, array['cos-admin-general', 'cos-admin-thread'], 'an admin reads their own conversations with the Chief of Staff, not a member''s');
select is((select count(*)::int from public.sessions where id = '00000000-0000-0000-0000-00000000f404'), 1, 'and the coworkers'' as before');
select is((select count(*)::int from public.agents where id = (select id from chief)), 0, 'the Chief of Staff row itself stays out of reach');
select is((select count(*)::int from public.member_foreman_agent_ids()), 1, 'its own workspace''s Chief of Staff only');
select throws_ok(
    $$ insert into public.sessions (agent_id, owner_id, engine_session_id) select id, '00000000-0000-0000-0000-00000000f101', 'browser-made' from chief $$,
    '42501', null, 'a browser token does not open a conversation with the Chief of Staff');
update public.sessions set title = 'renamed from the browser' where id = '00000000-0000-0000-0000-00000000f401';
delete from public.sessions where id = '00000000-0000-0000-0000-00000000f401';
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select set_eq($$ select engine_session_id from public.sessions where agent_id = (select id from chief) $$, array['cos-member-general'], 'a member reads their own only');
select throws_ok($$ select public.ensure_foreman_agent(990201) $$, '42501', null, 'a browser token cannot write the Chief of Staff');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f103');
select is((select count(*)::int from public.sessions where agent_id = (select id from chief)), 0, 'someone of another workspace reads none');
reset role;

select is((select title from public.sessions where id = '00000000-0000-0000-0000-00000000f401'), 'General', 'a browser token neither renames nor deletes one');

-- Someone who leaves the workspace keeps their rows but reads none of them any more.
delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000f102' and workspace_id = 990201;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000f102');
select is((select count(*)::int from public.sessions where owner_id = '00000000-0000-0000-0000-00000000f102'), 0, 'a member who left reads none of their conversations');
reset role;

-- An account deleted takes its conversations with it, from both tables.
delete from public.users where id = '00000000-0000-0000-0000-00000000f102';
select is((select count(*)::int from public.sessions where owner_id = '00000000-0000-0000-0000-00000000f102'), 0, 'a deleted account takes its conversations');
select is((select count(*)::int from public.foreman_conversations where user_id = '00000000-0000-0000-0000-00000000f102'), 0, 'from the old table too');
select is((select count(*)::int from public.sessions where id = '00000000-0000-0000-0000-00000000f401'), 1, 'and leaves everyone else''s');

-- The coworker previews and the workspace's coworkers do not count it.
select set_eq($$ select agent_id from public.coworker_previews(990201) $$, array['00000000-0000-0000-0000-00000000f301'::uuid], 'the Simple view still lists the coworkers only');

select * from finish();
rollback;
