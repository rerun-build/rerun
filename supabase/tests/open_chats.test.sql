-- The open chats of each person (migration 20261124091500_open_chats): the hub alone reads and writes
-- them, and they go with the conversation they name.
-- Runs with `pnpm exec supabase test db` on the local stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000f101', 'open-chats@rerun.test');
insert into public.workspaces (id, icon_url, name) values (991101, '', 'Open chats test');
insert into public.users (id, workspace_id) values ('00000000-0000-0000-0000-00000000f101', 991101)
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end, visibility) values
    ('00000000-0000-0000-0000-0000000e0101', 991101, 'Open', 0, 0, 3, 3, 'workspace');
insert into public.agents (id, workspace_id, space_id, name, col, "row") values
    ('00000000-0000-0000-0000-0000000e1101', 991101, '00000000-0000-0000-0000-0000000e0101', 'open-chats-agent', 1, 1);
insert into public.sessions (id, agent_id, engine_session_id, kind) values
    ('00000000-0000-0000-0000-0000000e3101', '00000000-0000-0000-0000-0000000e1101', 'open-chats-thread', 'thread');

select ok(has_table_privilege('service_role', 'public.open_chats', 'select, insert, update, delete'), 'the hub writes open chats');
select ok(has_table_privilege('service_role', 'public.open_chat_states', 'select, insert, update, delete'), 'the hub writes what was picked last');
select ok(not has_table_privilege('authenticated', 'public.open_chats', 'select'), 'a member reads no open chat directly');
select ok(not has_table_privilege('authenticated', 'public.open_chat_states', 'select'), 'a member reads no pick directly');
select ok(not has_table_privilege('anon', 'public.open_chats', 'select'), 'nor does a visitor');
select ok(not has_table_privilege('anon', 'public.open_chat_states', 'select'), 'nor does a visitor read a pick');
select ok((select relrowsecurity from pg_class where oid = 'public.open_chats'::regclass), 'row level security is on');
select ok((select relrowsecurity from pg_class where oid = 'public.open_chat_states'::regclass), 'row level security is on for picks');

insert into public.open_chats (user_id, session_id, agent_id) values
    ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-0000000e3101', '00000000-0000-0000-0000-0000000e1101');
insert into public.open_chat_states (user_id, agent_id, active_session_id, device_id, device_kind) values
    ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-0000000e1101', '00000000-0000-0000-0000-0000000e3101', gen_random_uuid(), 'phone');
select throws_ok(
    $$ update public.open_chat_states set device_kind = 'fridge' where agent_id = '00000000-0000-0000-0000-0000000e1101' $$,
    '23514', null, 'a device is a computer or a phone');

delete from public.sessions where id = '00000000-0000-0000-0000-0000000e3101';
select is((select count(*)::int from public.open_chats where agent_id = '00000000-0000-0000-0000-0000000e1101'), 0, 'a deleted conversation is open nowhere');
select is((select active_session_id from public.open_chat_states where agent_id = '00000000-0000-0000-0000-0000000e1101'), null, 'a deleted pick reads as General');

delete from public.agents where id = '00000000-0000-0000-0000-0000000e1101';
select is((select count(*)::int from public.open_chat_states where user_id = '00000000-0000-0000-0000-00000000f101'), 0, 'a deleted coworker takes its picks with it');

select * from finish();
rollback;
