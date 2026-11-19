-- RLS of the access by Box (migration 20261105130000_space_access), seen from an admin and from
-- members with each scope. Runs with `pnpm exec supabase test db` on the local stack; everything is
-- rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(46);

-- Fixtures: one workspace, an admin, a member scoped to `all`, a member scoped to `assigned`, and
-- someone who belongs to no workspace. The `all` member is also the admin of a second workspace.
insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000a001', 'rls-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000a002', 'rls-member@rerun.test'),
    ('00000000-0000-0000-0000-00000000a003', 'rls-assigned@rerun.test'),
    ('00000000-0000-0000-0000-00000000a004', 'rls-stranger@rerun.test');
insert into public.workspaces (id, icon_url, name) values (990001, '', 'RLS test'), (990002, '', 'RLS second');
insert into public.users (id, workspace_id)
select id, 990001 from auth.users where email like 'rls-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role, box_scope) values
    ('00000000-0000-0000-0000-00000000a001', 990001, 'admin', 'all'),
    ('00000000-0000-0000-0000-00000000a002', 990001, 'member', 'all'),
    ('00000000-0000-0000-0000-00000000a003', 990001, 'member', 'assigned'),
    ('00000000-0000-0000-0000-00000000a002', 990002, 'admin', 'all');

-- Open: open to the workspace. Closed: restricted, nobody named. Shared: restricted, the `all`
-- member named with `use`. Managed: open, the `assigned` member named with `manage`.
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end, visibility) values
    ('00000000-0000-0000-0000-0000000b0001', 990001, 'Open', 0, 0, 3, 3, 'workspace'),
    ('00000000-0000-0000-0000-0000000b0002', 990001, 'Closed', 4, 0, 7, 3, 'restricted'),
    ('00000000-0000-0000-0000-0000000b0003', 990001, 'Shared', 8, 0, 11, 3, 'restricted'),
    ('00000000-0000-0000-0000-0000000b0004', 990001, 'Managed', 12, 0, 15, 3, 'workspace'),
    ('00000000-0000-0000-0000-0000000b0005', 990002, 'Elsewhere', 0, 0, 3, 3, 'restricted');
insert into public.space_members (space_id, user_id, workspace_id, access) values
    ('00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-00000000a002', 990001, 'use'),
    ('00000000-0000-0000-0000-0000000b0004', '00000000-0000-0000-0000-00000000a003', 990001, 'manage');
insert into public.agents (id, workspace_id, space_id, name, col, "row") values
    ('00000000-0000-0000-0000-0000000c0001', 990001, '00000000-0000-0000-0000-0000000b0001', 'open-agent', 1, 1),
    ('00000000-0000-0000-0000-0000000c0002', 990001, '00000000-0000-0000-0000-0000000b0002', 'closed-agent', 1, 1),
    ('00000000-0000-0000-0000-0000000c0003', 990001, '00000000-0000-0000-0000-0000000b0003', 'shared-agent', 1, 1),
    ('00000000-0000-0000-0000-0000000c0004', 990001, '00000000-0000-0000-0000-0000000b0004', 'managed-agent', 1, 1),
    ('00000000-0000-0000-0000-0000000c0005', 990002, '00000000-0000-0000-0000-0000000b0005', 'elsewhere-agent', 1, 1);
insert into public.sessions (id, agent_id, engine_session_id) values
    ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-0000000c0001', 'rls-open'),
    ('00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-0000000c0002', 'rls-closed');
insert into public.notifications (workspace_id, agent_id, space_id, message) values
    (990001, '00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000b0001', 'open'),
    (990001, '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000b0002', 'closed'),
    (990001, null, null, 'workspace-wide');
insert into public.message_feedback (workspace_id, agent_id, message_id, rating, message_text) values
    (990001, '00000000-0000-0000-0000-0000000c0002', 'rls-closed-vote', 'down', 'closed transcript');

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- visible_agent_ids() and visible_space_ids() (rewritten in 20261119083712): exactly the coworkers
-- and the Boxes of each rule, across every workspace of the caller, nothing without a membership.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
select set_eq($$ select * from public.visible_agent_ids() $$, array['00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-0000000c0004']::uuid[], 'admin: every coworker of the workspace, restricted Boxes included');
select set_eq($$ select * from public.visible_space_ids() $$, array['00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-0000000b0004']::uuid[], 'admin: every Box of the workspace');
select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select set_eq($$ select * from public.visible_agent_ids() $$, array['00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000c0003', '00000000-0000-0000-0000-0000000c0004', '00000000-0000-0000-0000-0000000c0005']::uuid[], 'member (all) of one workspace, admin of another: the open and named Boxes of the first, everything of the second');
select set_eq($$ select * from public.visible_space_ids() $$, array['00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-0000000b0004', '00000000-0000-0000-0000-0000000b0005']::uuid[], 'member of two workspaces: the Boxes each membership reaches');
select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select set_eq($$ select * from public.visible_agent_ids() $$, array['00000000-0000-0000-0000-0000000c0004']::uuid[], 'member (assigned): only the coworkers of the Box named to them');
select set_eq($$ select * from public.visible_space_ids() $$, array['00000000-0000-0000-0000-0000000b0004']::uuid[], 'member (assigned): only the Box named to them');
select pg_temp.act_as('00000000-0000-0000-0000-00000000a004');
select is((select count(*)::int from public.visible_agent_ids()), 0, 'no membership: no coworker');
select is((select count(*)::int from public.visible_space_ids()), 0, 'no membership: no Box');
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.visible_agent_ids()), 0, 'no token: no coworker');
select is((select count(*)::int from public.visible_space_ids()), 0, 'no token: no Box');

-- Recording a read: on a conversation the caller sees, again and again, never for someone else nor
-- on a conversation of a hidden coworker.
select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select lives_ok($$ insert into public.session_reads (session_id, user_id) values ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-00000000a002') $$, 'a member records a read on a visible conversation');
select lives_ok($$ insert into public.session_reads (session_id, user_id) values ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-00000000a002') on conflict (session_id, user_id) do update set seen_at = excluded.seen_at $$, 'the same read recorded again moves it forward');
select throws_ok($$ insert into public.session_reads (session_id, user_id) values ('00000000-0000-0000-0000-0000000d0002', '00000000-0000-0000-0000-00000000a002') $$, '42501', null, 'no read on a conversation of a hidden coworker');
select throws_ok($$ insert into public.session_reads (session_id, user_id) values ('00000000-0000-0000-0000-0000000d0001', '00000000-0000-0000-0000-00000000a001') $$, '42501', null, 'no read recorded in someone else''s name');
reset role;
select ok(has_function_privilege('authenticated', 'public.visible_agent_ids()', 'execute') and has_function_privilege('authenticated', 'public.visible_space_ids()', 'execute'), 'a signed-in browser can still call both functions');
select ok(not has_function_privilege('anon', 'public.visible_agent_ids()', 'execute') and not has_function_privilege('anon', 'public.visible_space_ids()', 'execute'), 'a visitor without an account cannot');
select has_index('public', 'spaces', 'spaces_workspace_idx', 'spaces are read by workspace through an index');
select has_index('public', 'notifications', 'notifications_engine_session_idx', 'the notifications of a conversation are read through an index');

-- Admin: everything.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000a001');
select is((select count(*)::int from public.spaces where workspace_id = 990001), 4, 'admin sees every Box');
select is((select count(*)::int from public.agents where workspace_id = 990001), 4, 'admin sees every coworker');
select is((select count(*)::int from public.space_members where workspace_id = 990001), 2, 'admin reads every access row');
select is((select count(*)::int from public.manageable_space_ids() m join public.spaces s on s.id = m where s.workspace_id = 990001), 4, 'admin manages every Box');
select throws_ok($$ select * from public.message_feedback $$, '42501', null, 'message feedback is not readable with a browser token, even an admin one');

-- Member scoped to all: open Boxes plus the one shared with them, never the closed one.
select pg_temp.act_as('00000000-0000-0000-0000-00000000a002');
select set_eq($$ select name from public.spaces where workspace_id = 990001 $$, array['Open', 'Shared', 'Managed'], 'member (all) sees open Boxes and the one named to them');
select set_eq($$ select name from public.agents where workspace_id = 990001 $$, array['open-agent', 'shared-agent', 'managed-agent'], 'member (all) sees the coworkers of those Boxes');
select is((select count(*)::int from public.sessions where engine_session_id = 'rls-closed'), 0, 'member (all) does not see a session of a hidden coworker');
select is((select count(*)::int from public.sessions where engine_session_id = 'rls-open'), 1, 'member (all) sees a session of a visible coworker');
select set_eq($$ select message from public.notifications where workspace_id = 990001 $$, array['open', 'workspace-wide'], 'member (all) gets notifications of visible coworkers and workspace-wide ones');
select is((select count(*)::int from public.space_members where workspace_id = 990001), 1, 'member reads only their own access rows');
select throws_ok($$ select transcript from public.message_feedback $$, '42501', null, 'member cannot read the votes, nor the transcripts they copy');

update public.spaces set name = 'Renamed' where id = '00000000-0000-0000-0000-0000000b0001';
select is((select name from public.spaces where id = '00000000-0000-0000-0000-0000000b0001'), 'Open', 'member with use cannot rename an open Box');
update public.agents set col = 2 where id = '00000000-0000-0000-0000-0000000c0001';
select is((select col from public.agents where id = '00000000-0000-0000-0000-0000000c0001'), 1, 'member with use cannot move a coworker');
delete from public.agents where id = '00000000-0000-0000-0000-0000000c0003';
select is((select count(*)::int from public.agents where id = '00000000-0000-0000-0000-0000000c0003'), 1, 'member with use cannot delete a coworker');
select throws_ok(
    $$ insert into public.agents (workspace_id, space_id, name) values (990001, '00000000-0000-0000-0000-0000000b0001', 'sneaky') $$,
    '42501', null, 'member with use cannot create a coworker in the Box');
select throws_ok(
    $$ insert into public.space_members (space_id, user_id, workspace_id, access) values ('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-00000000a002', 990001, 'manage') $$,
    '42501', null, 'a member cannot grant themselves access');
update public.workspace_members set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000a002' and workspace_id = 990001;
select is((select role::text from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000a002' and workspace_id = 990001), 'member', 'a member cannot promote themselves');

-- Member scoped to assigned: only what is named to them, and they manage it.
select pg_temp.act_as('00000000-0000-0000-0000-00000000a003');
select set_eq($$ select name from public.spaces where workspace_id = 990001 $$, array['Managed'], 'member (assigned) sees only the Box named to them');
select set_eq($$ select name from public.agents where workspace_id = 990001 $$, array['managed-agent'], 'member (assigned) sees only its coworkers');
select set_eq($$ select message from public.notifications where workspace_id = 990001 $$, array['workspace-wide'], 'member (assigned) gets no notification of a hidden coworker');

update public.spaces set name = 'Mine' where id = '00000000-0000-0000-0000-0000000b0004';
select is((select name from public.spaces where id = '00000000-0000-0000-0000-0000000b0004'), 'Mine', 'manager renames their Box');
update public.agents set col = 5 where id = '00000000-0000-0000-0000-0000000c0004';
select is((select col from public.agents where id = '00000000-0000-0000-0000-0000000c0004'), 5, 'manager moves a coworker inside their Box');
select lives_ok(
    $$ insert into public.agents (workspace_id, space_id, name) values (990001, '00000000-0000-0000-0000-0000000b0004', 'made-by-manager') $$,
    'manager creates a coworker in their Box');
select throws_ok(
    $$ update public.agents set space_id = '00000000-0000-0000-0000-0000000b0001' where id = '00000000-0000-0000-0000-0000000c0004' $$,
    '42501', null, 'manager cannot move a coworker into a Box they do not manage');

reset role;

-- Cascades: leaving the workspace or deleting the Box takes the access rows with it.
delete from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000a002' and workspace_id = 990001;
select is((select count(*)::int from public.space_members where user_id = '00000000-0000-0000-0000-00000000a002'), 0, 'removing a member removes their access rows');
delete from public.agents where space_id = '00000000-0000-0000-0000-0000000b0004';
delete from public.spaces where id = '00000000-0000-0000-0000-0000000b0004';
select is((select count(*)::int from public.space_members where space_id = '00000000-0000-0000-0000-0000000b0004'), 0, 'deleting a Box removes its access rows');

-- Defaults keep today's behaviour.
insert into public.spaces (workspace_id, name, col_start, row_start, col_end, row_end) values (990001, 'Default', 20, 0, 23, 3);
select is((select visibility from public.spaces where name = 'Default' and workspace_id = 990001), 'workspace', 'a new Box is open to the workspace');

select * from finish();
rollback;
