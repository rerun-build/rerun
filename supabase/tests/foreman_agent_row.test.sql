-- The Chief of Staff's row and its private conversations (migration 20261123163217_foreman_agent_row),
-- seen from an admin, a member who reaches every Box, a member who reaches none, and a stranger.
-- Runs with `pnpm exec supabase test db` on the local stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(27);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000f001', 'cos-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000f002', 'cos-member@rerun.test'),
    ('00000000-0000-0000-0000-00000000f003', 'cos-assigned@rerun.test'),
    ('00000000-0000-0000-0000-00000000f004', 'cos-stranger@rerun.test');
insert into public.workspaces (id, icon_url, name) values (991001, '', 'CoS test'), (991002, '', 'CoS other');
insert into public.users (id, workspace_id)
select id, 991001 from auth.users where email like 'cos-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role, box_scope) values
    ('00000000-0000-0000-0000-00000000f001', 991001, 'admin', 'all'),
    ('00000000-0000-0000-0000-00000000f002', 991001, 'member', 'all'),
    ('00000000-0000-0000-0000-00000000f003', 991001, 'member', 'assigned'),
    ('00000000-0000-0000-0000-00000000f004', 991002, 'admin', 'all');
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end, visibility) values
    ('00000000-0000-0000-0000-0000000e0001', 991001, 'Open', 0, 0, 3, 3, 'workspace');
insert into public.agents (id, workspace_id, space_id, name, col, "row") values
    ('00000000-0000-0000-0000-0000000e1001', 991001, '00000000-0000-0000-0000-0000000e0001', 'open-agent', 1, 1);
insert into public.agents (id, workspace_id, kind, space_id, name, engine_agent_id) values
    ('00000000-0000-0000-0000-0000000e2001', 991001, 'foreman', null, 'Chief of Staff', 'foreman'),
    ('00000000-0000-0000-0000-0000000e2002', 991002, 'foreman', null, 'Chief of Staff', 'foreman');
insert into public.sessions (id, agent_id, engine_session_id, kind, owner_user_id) values
    ('00000000-0000-0000-0000-0000000e3001', '00000000-0000-0000-0000-0000000e2001', 'cos-admin-general', 'general', '00000000-0000-0000-0000-00000000f001'),
    ('00000000-0000-0000-0000-0000000e3002', '00000000-0000-0000-0000-0000000e2001', 'cos-member-general', 'general', '00000000-0000-0000-0000-00000000f002'),
    ('00000000-0000-0000-0000-0000000e3003', '00000000-0000-0000-0000-0000000e2001', 'cos-member-thread', 'thread', '00000000-0000-0000-0000-00000000f002'),
    ('00000000-0000-0000-0000-0000000e3004', '00000000-0000-0000-0000-0000000e1001', 'open-general', 'general', null);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- The shape of the row.
select throws_ok(
    $$ insert into public.agents (workspace_id, kind, space_id, name) values (991001, 'foreman', null, 'second') $$,
    '23505', null, 'one Chief of Staff per workspace');
select throws_ok(
    $$ insert into public.agents (workspace_id, kind, space_id, name) values (991002, 'coworker', null, 'boxless') $$,
    '23514', null, 'a coworker always sits in a Box');
select throws_ok(
    $$ insert into public.agents (workspace_id, kind, space_id, name) values (991001, 'foreman', '00000000-0000-0000-0000-0000000e0001', 'boxed') $$,
    '23514', null, 'the Chief of Staff never sits in a Box');
select is((select count(*)::int from public.workspace_getting_started where workspace_id = 991002 and item = 'first_agent'), 0, 'its row is not the first coworker of the checklist');
select is((select count(*)::int from public.workspace_getting_started where workspace_id = 991001 and item = 'first_agent'), 1, 'a coworker still is');
select is((select kind::text from public.agents where id = '00000000-0000-0000-0000-0000000e1001'), 'coworker', 'a row written without a kind is a coworker');

-- One General per member with it, one per coworker otherwise.
select lives_ok(
    $$ insert into public.sessions (agent_id, engine_session_id, kind, owner_user_id) values ('00000000-0000-0000-0000-0000000e2001', 'cos-assigned-general', 'general', '00000000-0000-0000-0000-00000000f003') $$,
    'each member opens a General of their own with it');
select throws_ok(
    $$ insert into public.sessions (agent_id, engine_session_id, kind, owner_user_id) values ('00000000-0000-0000-0000-0000000e2001', 'cos-member-general-2', 'general', '00000000-0000-0000-0000-00000000f002') $$,
    '23505', null, 'never two for the same member');
select throws_ok(
    $$ insert into public.sessions (agent_id, engine_session_id, kind) values ('00000000-0000-0000-0000-0000000e1001', 'open-general-2', 'general') $$,
    '23505', null, 'a shared coworker keeps a single General');

set local role authenticated;

-- Every member reaches the Chief of Staff of their workspace, and only theirs.
select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select ok('00000000-0000-0000-0000-0000000e2001'::uuid in (select public.visible_agent_ids()), 'the admin reaches it');
select ok('00000000-0000-0000-0000-0000000e2002'::uuid not in (select public.visible_agent_ids()), 'not the one of another workspace');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f003');
select set_eq($$ select * from public.visible_agent_ids() $$, array['00000000-0000-0000-0000-0000000e2001']::uuid[], 'a member who reaches no Box still reaches it, and nothing else');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f002');
select set_eq($$ select * from public.visible_agent_ids() $$, array['00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-0000000e2001']::uuid[], 'a member reaches it beside the coworkers of their Boxes');

-- A private conversation is its owner's alone, the admin's included.
select set_eq($$ select engine_session_id from public.sessions where agent_id = '00000000-0000-0000-0000-0000000e2001' $$, array['cos-member-general', 'cos-member-thread'], 'a member reads their own conversations with it');
select is((select count(*)::int from public.sessions where engine_session_id = 'open-general'), 1, 'and still the shared ones of their coworkers');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select set_eq($$ select engine_session_id from public.sessions where agent_id = '00000000-0000-0000-0000-0000000e2001' $$, array['cos-admin-general'], 'the admin reads only theirs');
update public.sessions set title = 'hijacked' where id = '00000000-0000-0000-0000-0000000e3002';
delete from public.sessions where id = '00000000-0000-0000-0000-0000000e3003';
reset role;
select is((select title from public.sessions where id = '00000000-0000-0000-0000-0000000e3002'), 'New conversation', 'nor renames a member''s');
select is((select count(*)::int from public.sessions where id = '00000000-0000-0000-0000-0000000e3003'), 1, 'nor deletes one');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select throws_ok(
    $$ insert into public.sessions (agent_id, engine_session_id, kind, owner_user_id) values ('00000000-0000-0000-0000-0000000e2001', 'cos-forged', 'thread', '00000000-0000-0000-0000-00000000f002') $$,
    '42501', null, 'nor opens one in a member''s name');
select throws_ok(
    $$ insert into public.session_reads (session_id, user_id) values ('00000000-0000-0000-0000-0000000e3002', '00000000-0000-0000-0000-00000000f001') $$,
    '42501', null, 'nor marks one read');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f002');
select throws_ok(
    $$ update public.sessions set owner_user_id = '00000000-0000-0000-0000-00000000f001' where id = '00000000-0000-0000-0000-0000000e3003' $$,
    '42501', null, 'the owner cannot hand a conversation to someone else');
select lives_ok(
    $$ insert into public.session_reads (session_id, user_id) values ('00000000-0000-0000-0000-0000000e3002', '00000000-0000-0000-0000-00000000f002') $$,
    'the owner marks it read');

-- The row itself: read by every member, written by nobody from a browser.
select is((select count(*)::int from public.agents where kind = 'foreman'), 1, 'a member reads the row of their workspace only');
update public.agents set name = 'Renamed' where id = '00000000-0000-0000-0000-0000000e2001';
select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
update public.agents set name = 'Renamed' where id = '00000000-0000-0000-0000-0000000e2001';
delete from public.agents where id = '00000000-0000-0000-0000-0000000e2001';
reset role;
select is((select name from public.agents where id = '00000000-0000-0000-0000-0000000e2001'), 'Chief of Staff', 'no browser renames it, the admin''s included');
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000e2001'), 1, 'no browser deletes it');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000f001');
select throws_ok(
    $$ insert into public.agents (workspace_id, kind, space_id, name) values (991002, 'foreman', null, 'planted') $$,
    '42501', null, 'no browser creates one');
select pg_temp.act_as('00000000-0000-0000-0000-00000000f004');
select is((select count(*)::int from public.sessions where agent_id = '00000000-0000-0000-0000-0000000e2001'), 0, 'someone of another workspace reads none of its conversations');

select * from finish();
rollback;
