-- The order of the Simple view's list (migration 20261116120000_sidebar_order): who manages a Box
-- arranges it and its coworkers, who only uses it cannot. Runs with `pnpm exec supabase test db` on
-- the local stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(4);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000d001', 'order-admin@rerun.test'),
    ('00000000-0000-0000-0000-00000000d002', 'order-member@rerun.test');
insert into public.workspaces (id, icon_url, name) values (990002, '', 'Order test');
insert into public.users (id, workspace_id)
select id, 990002 from auth.users where email like 'order-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.workspace_members (user_id, workspace_id, role, box_scope) values
    ('00000000-0000-0000-0000-00000000d001', 990002, 'admin', 'all'),
    ('00000000-0000-0000-0000-00000000d002', 990002, 'member', 'all');
insert into public.spaces (id, workspace_id, name, col_start, row_start, col_end, row_end, visibility) values
    ('00000000-0000-0000-0000-0000000e0001', 990002, 'Open', 0, 0, 3, 3, 'workspace');
insert into public.agents (id, workspace_id, space_id, name, col, "row") values
    ('00000000-0000-0000-0000-0000000f0001', 990002, '00000000-0000-0000-0000-0000000e0001', 'order-agent', 1, 1);

create function pg_temp.act_as(uid uuid) returns void language sql as $$
    select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-00000000d002');
update public.spaces set sidebar_order = 5 where id = '00000000-0000-0000-0000-0000000e0001';
update public.agents set sidebar_order = 5 where id = '00000000-0000-0000-0000-0000000f0001';
select is((select sidebar_order from public.spaces where id = '00000000-0000-0000-0000-0000000e0001'), null::double precision, 'a member who only uses the Box cannot move it in the list');
select is((select sidebar_order from public.agents where id = '00000000-0000-0000-0000-0000000f0001'), null::double precision, 'nor move its coworkers');

select pg_temp.act_as('00000000-0000-0000-0000-00000000d001');
update public.spaces set sidebar_order = 2.5 where id = '00000000-0000-0000-0000-0000000e0001';
update public.agents set sidebar_order = 1.5 where id = '00000000-0000-0000-0000-0000000f0001';
select is((select sidebar_order from public.spaces where id = '00000000-0000-0000-0000-0000000e0001'), 2.5::double precision, 'an admin moves the Box in the list');
select is((select sidebar_order from public.agents where id = '00000000-0000-0000-0000-0000000f0001'), 1.5::double precision, 'and its coworkers');

select * from finish();
rollback;
