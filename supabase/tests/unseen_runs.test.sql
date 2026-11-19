-- unseen_runs (20261119094317_unseen_runs_by_recipient): the finished runs a member has not looked
-- at, one row per conversation, newest first, through the same access rules as the notifications
-- and sessions policies. Runs with `pnpm exec supabase test db` on the local stack; rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(10);

-- An admin, a member scoped to `all`, a member scoped to `assigned` with no Box named to them.
insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000e001', 'ur-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000e002', 'ur-member@rerun.test'),
    ('00000000-0000-0000-0000-00000000e003', 'ur-assigned@rerun.test');
insert into public.workspaces (id, icon_url, name) values (990101, '', 'Unseen runs'), (990102, '', 'Someone else');
insert into public.users (id, workspace_id)
select id, 990101 from auth.users where email like 'ur-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role, box_scope) values
    ('00000000-0000-0000-0000-00000000e001', 990101, 'admin', 'all'),
    ('00000000-0000-0000-0000-00000000e002', 990101, 'member', 'all'),
    ('00000000-0000-0000-0000-00000000e003', 990101, 'member', 'assigned');
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end, visibility) values
    ('00000000-0000-0000-0000-0000000f0001', 990101, 'Open', 0, 0, 3, 3, 'workspace'),
    ('00000000-0000-0000-0000-0000000f0002', 990101, 'Closed', 4, 0, 7, 3, 'restricted'),
    ('00000000-0000-0000-0000-0000000f0003', 990102, 'Theirs', 0, 0, 3, 3, 'workspace');
insert into public.agents (id, workspace_id, space_id, name, col, "row") values
    ('00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', 'open-agent', 1, 1),
    ('00000000-0000-0000-0000-0000000a0e02', 990101, '00000000-0000-0000-0000-0000000f0002', 'closed-agent', 1, 1),
    ('00000000-0000-0000-0000-0000000a0e03', 990102, '00000000-0000-0000-0000-0000000f0003', 'their-agent', 1, 1);
insert into public.sessions (id, agent_id, engine_session_id) values
    ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000a0e01', 'ur-twice'),
    ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000a0e01', 'ur-never-read'),
    ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-0000000a0e01', 'ur-read-after'),
    ('00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-0000000a0e02', 'ur-closed'),
    ('00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-0000000a0e01', 'ur-no-recipients'),
    ('00000000-0000-0000-0000-00000000c006', '00000000-0000-0000-0000-0000000a0e01', 'ur-member-only'),
    ('00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-0000000a0e03', 'ur-theirs');
-- The routine's name the session keeps, for a one-off whose schedule deleted itself after its run.
update public.sessions set automation_name = 'Daily digest' where id = '00000000-0000-0000-0000-00000000c001';

-- Times are relative to now(), the transaction's start, so they all fall after the floor the
-- function carries, except the one placed before it on purpose.
create function pg_temp.done(session_engine_id text, agent uuid, workspace integer, space uuid, recipients jsonb, at timestamptz, message text, metadata jsonb default null, kind public.notification_kind default 'done')
returns void language sql as $$
    insert into public.notifications (workspace_id, agent_id, space_id, engine_session_id, kind, recipients, created_at, message, metadata)
    values (workspace, agent, space, session_engine_id, kind, recipients, at, message, metadata);
$$;
select pg_temp.done('ur-twice', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', '{"00000000-0000-0000-0000-00000000e001": "owner", "00000000-0000-0000-0000-00000000e002": "member"}', now() + interval '1 minute', 'first');
select pg_temp.done('ur-twice', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', '{"00000000-0000-0000-0000-00000000e001": "owner", "00000000-0000-0000-0000-00000000e002": "member"}', now() + interval '2 minutes', 'second', '{"scheduleSlug": "daily"}');
select pg_temp.done('ur-twice', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', '{"00000000-0000-0000-0000-00000000e001": "owner"}', now() + interval '9 minutes', 'a question, not a finished run', null, 'info');
select pg_temp.done('ur-never-read', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', '{"00000000-0000-0000-0000-00000000e001": "owner", "00000000-0000-0000-0000-00000000e002": "member"}', now() + interval '3 minutes', 'never read');
select pg_temp.done('ur-read-after', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', '{"00000000-0000-0000-0000-00000000e001": "owner", "00000000-0000-0000-0000-00000000e002": "member"}', now() + interval '1 minute', 'read since');
select pg_temp.done('ur-closed', '00000000-0000-0000-0000-0000000a0e02', 990101, '00000000-0000-0000-0000-0000000f0002', '{"00000000-0000-0000-0000-00000000e001": "owner", "00000000-0000-0000-0000-00000000e002": "member"}', now() + interval '4 minutes', 'in a closed Box');
select pg_temp.done('ur-no-recipients', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', null, now() + interval '5 minutes', 'from before recipients existed');
select pg_temp.done('ur-member-only', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', '{"00000000-0000-0000-0000-00000000e002": "member"}', now() + interval '30 seconds', 'for the member alone');
select pg_temp.done('ur-member-only', '00000000-0000-0000-0000-0000000a0e01', 990101, '00000000-0000-0000-0000-0000000f0001', '{"00000000-0000-0000-0000-00000000e001": "owner"}',
    substring(pg_get_functiondef('public.unseen_runs(integer)'::regprocedure) from 'coalesce\(r\.seen_at, ''([^'']+)''::timestamp')::timestamptz - interval '1 day', 'before the floor');
select pg_temp.done('ur-theirs', '00000000-0000-0000-0000-0000000a0e03', 990102, '00000000-0000-0000-0000-0000000f0003', '{"00000000-0000-0000-0000-00000000e001": "owner"}', now() + interval '6 minutes', 'another workspace');

-- The admin looked at `ur-read-after` after its run finished. The trigger stamps every read with
-- now(); it is held off to place this one in the future.
alter table public.session_reads disable trigger session_reads_stamp_seen_at;
insert into public.session_reads (session_id, user_id, seen_at) values ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000e001', now() + interval '5 minutes');
alter table public.session_reads enable trigger session_reads_stamp_seen_at;

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-00000000e001');
select results_eq(
    $$ select session_id from public.unseen_runs(990101) $$,
    $$ values ('00000000-0000-0000-0000-00000000c004'::uuid), ('00000000-0000-0000-0000-00000000c002'::uuid), ('00000000-0000-0000-0000-00000000c001'::uuid) $$,
    'admin: one row per unread conversation, newest first, closed Box included; read since, unaddressed and before the floor left out'
);
select results_eq(
    $$ select run_count, message, slug, automation_name from public.unseen_runs(990101) where session_id = '00000000-0000-0000-0000-00000000c001' $$,
    $$ values (2, 'second', 'daily', 'Daily digest') $$,
    'two finished runs of one conversation: counted together, the latest one speaks, a question is not a run, the routine keeps its name'
);
select is((select count(*)::int from public.unseen_runs(990102)), 0, 'a workspace the caller does not belong to gives nothing, even addressed to them');

select pg_temp.act_as('00000000-0000-0000-0000-00000000e002');
select results_eq(
    $$ select session_id from public.unseen_runs(990101) $$,
    $$ values ('00000000-0000-0000-0000-00000000c002'::uuid), ('00000000-0000-0000-0000-00000000c001'::uuid), ('00000000-0000-0000-0000-00000000c003'::uuid), ('00000000-0000-0000-0000-00000000c006'::uuid) $$,
    'member (all): what the admin read is still news to them, the closed Box is not theirs'
);

select pg_temp.act_as('00000000-0000-0000-0000-00000000e003');
select is((select count(*)::int from public.unseen_runs(990101)), 0, 'member (assigned) with no Box: nothing');

select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.unseen_runs(990101)), 0, 'no token: nothing');

-- A read recorded through the policy hides the conversation as soon as nothing finished after it.
select pg_temp.act_as('00000000-0000-0000-0000-00000000e002');
reset role;
update public.notifications set created_at = now() - interval '1 second' where engine_session_id = 'ur-member-only' and message = 'for the member alone';
set local role authenticated;
insert into public.session_reads (session_id, user_id) values ('00000000-0000-0000-0000-00000000c006', '00000000-0000-0000-0000-00000000e002');
select is((select count(*)::int from public.unseen_runs(990101) where session_id = '00000000-0000-0000-0000-00000000c006'), 0, 'reading a conversation clears it');
select is((select count(*)::int from public.unseen_runs(990101)), 3, 'and only it');

reset role;
select ok(not has_function_privilege('anon', 'public.unseen_runs(integer)', 'execute'), 'a visitor without an account cannot call it');
select has_index('public', 'notifications', 'notifications_done_recipients_idx', 'finished runs are found by recipient through an index');

select * from finish();
rollback;
