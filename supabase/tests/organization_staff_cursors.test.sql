-- The cursors of a board (migration 20261125100030): a member sends and reads, the team of the
-- organization that runs the workspace reads only. Runs with `pnpm exec supabase test db` on the local
-- stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(8);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-0000000a1001', 'staff-cursor@rerun.test'),
    ('00000000-0000-0000-0000-0000000a1002', 'client-cursor@rerun.test'),
    ('00000000-0000-0000-0000-0000000a1003', 'stranger-cursor@rerun.test');
insert into public.workspaces (id, icon_url, name) values (990301, '', 'Client'), (990302, '', 'Own');
insert into public.users (id, workspace_id) select id, 990302 from auth.users where email like '%-cursor@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role, organization_staff) values
    ('00000000-0000-0000-0000-0000000a1001', 990301, 'admin', true),
    ('00000000-0000-0000-0000-0000000a1001', 990302, 'admin', false),
    ('00000000-0000-0000-0000-0000000a1002', 990301, 'member', false);

-- `realtime.topic()` answers this setting.
create function pg_temp.joining(uid text, topic text) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
           set_config('realtime.topic', topic, true)
$$;
create function pg_temp.sends(kind text) returns text language plpgsql as $$
begin
    insert into realtime.messages (topic, extension, payload, event, private) values (current_setting('realtime.topic'), kind, '{}', 'cursor', true);
    return 'accepted';
exception when insufficient_privilege then
    return 'refused';
end $$;

set local role authenticated;

select pg_temp.joining('00000000-0000-0000-0000-0000000a1002', 'cursors:990301');
select is(pg_temp.sends('broadcast'), 'accepted', 'a member moves their cursor');
select is(pg_temp.sends('presence'), 'accepted', 'and is present');

select pg_temp.joining('00000000-0000-0000-0000-0000000a1001', 'cursors:990301');
select is(pg_temp.sends('broadcast'), 'refused', 'the team of the organization sends no cursor');
select is(pg_temp.sends('presence'), 'refused', 'nor any presence');
select isnt((select count(*) from realtime.messages), 0::bigint, 'and reads those of the members');

select pg_temp.joining('00000000-0000-0000-0000-0000000a1001', 'cursors:990302');
select is(pg_temp.sends('broadcast'), 'accepted', 'in their own workspace they are a member');

select pg_temp.joining('00000000-0000-0000-0000-0000000a1003', 'cursors:990301');
select is(pg_temp.sends('broadcast'), 'refused', 'a stranger sends nothing');
select is((select count(*) from realtime.messages), 0::bigint, 'and reads nothing');

reset role;
select * from finish();
rollback;
