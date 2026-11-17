-- The Chief of Staff's place in `agents` (migration 20261117140000_agent_kind): one per workspace,
-- never in a Box, invisible to a browser token, left out of the coworker counts the database keeps.
-- Runs with `pnpm exec supabase test db` on the local stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(16);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000d001', 'kind-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000d002', 'kind-member@rerun.test');
insert into public.workspaces (id, icon_url, name) values (990101, '', 'Kind test'), (990102, '', 'Kind other');
insert into public.users (id, workspace_id)
select id, 990101 from auth.users where email like 'kind-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role) values
    ('00000000-0000-0000-0000-00000000d001', 990101, 'admin'),
    ('00000000-0000-0000-0000-00000000d002', 990101, 'member');
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end) values
    ('00000000-0000-0000-0000-0000000e0001', 990101, 'Box', 0, 0, 3, 3);

insert into public.agents (id, workspace_id, space_id, name) values
    ('00000000-0000-0000-0000-0000000f0001', 990101, '00000000-0000-0000-0000-0000000e0001', 'coworker');
select is((select kind::text from public.agents where id = '00000000-0000-0000-0000-0000000f0001'), 'coworker', 'a row written without a kind is a coworker');
select ok(exists (select 1 from public.workspace_getting_started where workspace_id = 990101 and item = 'first_agent'), 'hiring a coworker still ticks the first coworker');

delete from public.workspace_getting_started where workspace_id = 990101;
select lives_ok(
    $$ insert into public.agents (id, workspace_id, kind, name, engine_agent_id) values ('00000000-0000-0000-0000-0000000f0002', 990101, 'foreman', 'Chief of Staff', 'foreman') $$,
    'the Chief of Staff is written without a Box');
select ok(not exists (select 1 from public.workspace_getting_started where workspace_id = 990101 and item = 'first_agent'), 'the Chief of Staff does not tick the first coworker');

select throws_ok(
    $$ insert into public.agents (workspace_id, kind, name) values (990101, 'foreman', 'Second') $$,
    '23505', null, 'a workspace has one Chief of Staff');
select lives_ok(
    $$ insert into public.agents (workspace_id, kind, name, engine_agent_id) values (990102, 'foreman', 'Chief of Staff', 'foreman') $$,
    'another workspace has its own, with the same engine id');
select throws_ok(
    $$ insert into public.agents (workspace_id, name) values (990101, 'boxless') $$,
    '23514', null, 'a coworker without a Box is refused');
select throws_ok(
    $$ insert into public.agents (workspace_id, space_id, kind, name) values (990101, '00000000-0000-0000-0000-0000000e0001', 'foreman', 'boxed') $$,
    '23514', null, 'a Chief of Staff in a Box is refused');
select throws_ok(
    $$ update public.agents set space_id = '00000000-0000-0000-0000-0000000e0001' where id = '00000000-0000-0000-0000-0000000f0002' $$,
    '23514', null, 'the Chief of Staff cannot be moved into a Box');

select set_eq(
    $$ select agent_id from public.coworker_previews(990101) $$,
    array['00000000-0000-0000-0000-0000000f0001'::uuid],
    'the Simple view lists the coworkers only');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');
select set_eq($$ select name from public.agents where workspace_id = 990101 $$, array['coworker'], 'an admin token does not read the Chief of Staff row');
select set_eq($$ select agent_id from public.coworker_previews(990101) $$, array['00000000-0000-0000-0000-0000000f0001'::uuid], 'nor does the Simple view through it');
select throws_ok(
    $$ insert into public.agents (workspace_id, kind, name) values (990101, 'foreman', 'from the browser') $$,
    '42501', null, 'an admin token cannot write a Chief of Staff');
update public.agents set name = 'renamed' where id = '00000000-0000-0000-0000-0000000f0002';
delete from public.agents where id = '00000000-0000-0000-0000-0000000f0002';

select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
select set_eq($$ select name from public.agents where workspace_id = 990101 $$, array['coworker'], 'a member token does not read it either');

reset role;
select is((select name from public.agents where id = '00000000-0000-0000-0000-0000000f0002'), 'Chief of Staff', 'a browser token neither renames nor deletes it');

delete from public.workspaces where id = 990102;
select is((select count(*)::int from public.agents where workspace_id = 990102), 0, 'it goes with its workspace');

select * from finish();
rollback;
