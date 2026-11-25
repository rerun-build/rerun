-- Organizations (migrations 20261125100000 to 20261125100020): what their tables accept, what they
-- default to, and that nobody but the service role reads them. Runs with `pnpm exec supabase test db`
-- on the local stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(57);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-0000000a0001', 'org-owner@rerun.test'),
    ('00000000-0000-0000-0000-0000000a0002', 'org-client@rerun.test'),
    ('00000000-0000-0000-0000-0000000a0003', 'org-second@rerun.test');
insert into public.organizations (id, name, slug) values
    ('00000000-0000-0000-0000-0000000e0001', 'Nordlys', 'nordlys'),
    ('00000000-0000-0000-0000-0000000e0002', 'Havre', 'havre');
insert into public.workspaces (id, icon_url, name) values (990201, '', 'Own'), (990202, '', 'Client');
update public.workspaces set organization_id = '00000000-0000-0000-0000-0000000e0001' where id = 990202;
insert into public.users (id, workspace_id)
select id, 990202 from auth.users where email like 'org-%@rerun.test'
on conflict (id) do update set workspace_id = excluded.workspace_id;
insert into public.organization_members (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000a0001', 'owner');
delete from public.workspace_getting_started where workspace_id = 990202;
insert into public.workspace_members (user_id, workspace_id, role, organization_staff) values ('00000000-0000-0000-0000-0000000a0001', 990202, 'admin', true);
insert into public.workspace_members (user_id, workspace_id, role) values ('00000000-0000-0000-0000-0000000a0002', 990202, 'admin');

-- Defaults.
select is((select status from organizations where slug = 'nordlys'), 'active', 'an organization is born active');
select is((select max_workspaces from organizations where slug = 'nordlys'), 3, 'and holds three workspaces');
select is((select organization_id from workspaces where id = 990201), null::uuid, 'a workspace belongs to no organization');
select is((select organization_archived_at from workspaces where id = 990202), null::timestamptz, 'and is not put away by one');
select is((select organization_staff from workspace_members where user_id = '00000000-0000-0000-0000-0000000a0002' and workspace_id = 990202), false, 'a member is not staff');
insert into public.workspace_invitations (workspace_id, email, token, expires_at) values (990201, 'a@rerun.test', 'org-test-1', now() + interval '1 day');
select is((select role from workspace_invitations where token = 'org-test-1'), 'member'::workspace_role, 'an invitation makes a member unless it says otherwise');

-- organizations.
select lives_ok($$ insert into organizations (name, slug, color, docs_url) values ('A', 'abc', '#0a1b2c', 'https://docs.example.com') $$, 'a short name, a short slug, a color and a link');
select throws_ok($$ insert into organizations (name, slug) values ('', 'empty') $$, '23514', null, 'a name is never empty');
select throws_ok($$ insert into organizations (name, slug) values ('   ', 'blank') $$, '23514', null, 'nor blank');
select throws_ok($$ insert into organizations (name, slug) values (repeat('a', 41), 'long') $$, '23514', null, 'nor past 40 characters');
select throws_ok($$ insert into organizations (name, slug) values ('{brand}', 'icu') $$, '23514', null, 'nor carries ICU syntax');
select throws_ok($$ insert into organizations (name, slug) values ('a<b', 'markup') $$, '23514', null, 'nor markup');
select throws_ok($$ insert into organizations (name, slug) values (E'a\nb', 'newline') $$, '23514', null, 'nor a line break, which would end an email header');
select throws_ok($$ insert into organizations (name, slug) values ('Nordlys 2', 'nordlys') $$, '23505', null, 'two organizations never share a slug');
select throws_ok($$ insert into organizations (name, slug) values ('Upper', 'Nordlys2') $$, '23514', null, 'a slug is lowercase');
select throws_ok($$ insert into organizations (name, slug) values ('Dots', 'a.b') $$, '23514', null, 'a slug is one label');
select throws_ok($$ insert into organizations (name, slug) values ('Dash', '-ab') $$, '23514', null, 'a slug does not start with a dash');
select throws_ok($$ insert into organizations (name, slug) values ('Two', 'ab') $$, '23514', null, 'a slug has three characters');
select throws_ok($$ insert into organizations (name, slug, status) values ('S', 'sts', 'closed') $$, '23514', null, 'an unknown status is refused');
select throws_ok($$ insert into organizations (name, slug, max_workspaces) values ('M', 'mmm', -1) $$, '23514', null, 'a negative limit is refused');
select throws_ok($$ insert into organizations (name, slug, color) values ('C', 'ccc', 'red') $$, '23514', null, 'a color is a hex');
select throws_ok($$ insert into organizations (name, slug, color) values ('C', 'ccc', '#ABCDEF') $$, '23514', null, 'in lowercase');
select throws_ok($$ insert into organizations (name, slug, terms_url) values ('U', 'uuu', 'javascript:alert(1)') $$, '23514', null, 'a link is never a script');
select throws_ok($$ delete from organizations where slug = 'nordlys' $$, '23503', null, 'an organization is never deleted from under its workspaces');

-- organization_members.
select throws_ok($$ insert into organization_members (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000a0002', 'member') $$, '23514', null, 'a team role is owner or admin');
select throws_ok($$ insert into organization_members (organization_id, user_id, role) values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000a0001', 'admin') $$, '23505', null, 'one role each');

-- organization_invitations.
insert into public.organization_invitations (organization_id, email, role, token, expires_at) values ('00000000-0000-0000-0000-0000000e0001', 'new@rerun.test', 'admin', 'org-inv-1', now());
select is((select status from organization_invitations where token = 'org-inv-1'), 'pending', 'an invitation is born pending');
select throws_ok($$ insert into organization_invitations (organization_id, email, role, token, expires_at) values ('00000000-0000-0000-0000-0000000e0001', 'NEW@rerun.test', 'owner', 'org-inv-2', now()) $$, '23505', null, 'one pending per address, whatever its case');
select lives_ok($$ insert into organization_invitations (organization_id, email, role, token, expires_at) values ('00000000-0000-0000-0000-0000000e0002', 'new@rerun.test', 'owner', 'org-inv-3', now()) $$, 'another organization invites the same person');
update organization_invitations set status = 'revoked' where token = 'org-inv-1';
select lives_ok($$ insert into organization_invitations (organization_id, email, role, token, expires_at) values ('00000000-0000-0000-0000-0000000e0001', 'new@rerun.test', 'admin', 'org-inv-4', now()) $$, 'a revoked one leaves room for another');
select throws_ok($$ insert into organization_invitations (organization_id, email, role, token, expires_at) values ('00000000-0000-0000-0000-0000000e0001', 'b@rerun.test', 'admin', 'org-inv-4', now()) $$, '23505', null, 'a token is unique');
select throws_ok($$ insert into organization_invitations (organization_id, email, role, token, expires_at) values ('00000000-0000-0000-0000-0000000e0001', 'c@rerun.test', 'member', 'org-inv-5', now()) $$, '23514', null, 'an invitation carries a team role');

-- organization_credit_movements.
create function pg_temp.move(p_seq integer, p_kind text, p_micros bigint, p_balance bigint, p_request uuid default gen_random_uuid()) returns void language sql as $$
    insert into public.organization_credit_movements (organization_id, seq, kind, micros, balance_after, workspace_id, workspace_name, request_id)
    values ('00000000-0000-0000-0000-0000000e0001', p_seq, p_kind, p_micros, p_balance, 990202, 'Client', p_request)
$$;
select lives_ok($$ select pg_temp.move(1, 'purchase', 1000, 1000, '00000000-0000-0000-0000-0000000f0001') $$, 'a purchase opens the ledger');
select throws_ok($$ select pg_temp.move(1, 'purchase', 1000, 1000) $$, '23505', null, 'a number is taken once');
select throws_ok($$ select pg_temp.move(2, 'purchase', 1000, 2000, '00000000-0000-0000-0000-0000000f0001') $$, '23505', null, 'a request lands once');
select throws_ok($$ select pg_temp.move(2, 'allocation', -2000, -1000) $$, '23514', null, 'a balance never goes below zero');
select throws_ok($$ select pg_temp.move(2, 'allocation', 500, 1500) $$, '23514', null, 'an allocation takes from the reserve');
select throws_ok($$ select pg_temp.move(2, 'take_back', -500, 500) $$, '23514', null, 'a take back returns to it');
select throws_ok($$ select pg_temp.move(2, 'purchase', -500, 500) $$, '23514', null, 'a purchase adds to it');
select throws_ok($$ select pg_temp.move(2, 'adjustment', 0, 1000) $$, '23514', null, 'a movement moves something');
select throws_ok($$ select pg_temp.move(2, 'gift', 1, 1001) $$, '23514', null, 'an unknown kind is refused');
select throws_ok($$ select pg_temp.move(0, 'purchase', 1, 1) $$, '23514', null, 'numbers start at one');
select throws_ok($$ select pg_temp.move(2, 'purchase', 9007199254740992, 9007199254740992) $$, '23514', null, 'nothing past what JavaScript counts exactly');
select lives_ok($$ select pg_temp.move(2, 'adjustment', -200, 800) $$, 'an adjustment goes either way');
insert into public.workspaces (id, icon_url, name, organization_id) values (990203, '', 'Gone', '00000000-0000-0000-0000-0000000e0001');
update organization_credit_movements set workspace_id = 990203, workspace_name = 'Gone' where seq = 2;
delete from workspaces where id = 990203;
select is((select array[workspace_id::text, workspace_name] from organization_credit_movements where seq = 2), array[null, 'Gone'], 'the history outlives the workspace, under its name');

-- The getting started checklist of a client.
select is((select count(*) from workspace_getting_started where workspace_id = 990202 and item = 'invite'), 0::bigint, 'the team of an organization is not a teammate');
insert into public.workspace_invitations (workspace_id, email, role, token, expires_at) values (990202, 'first@rerun.test', 'admin', 'org-test-2', now() + interval '1 day');
select is((select count(*) from workspace_getting_started where workspace_id = 990202 and item = 'invite'), 0::bigint, 'nor is the first admin it invites');
insert into public.workspace_members (user_id, workspace_id, role) values ('00000000-0000-0000-0000-0000000a0003', 990202, 'member');
select is((select count(*) from workspace_getting_started where workspace_id = 990202 and item = 'invite'), 1::bigint, 'a second person of the client is');

-- Grants.
select is(
    (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated') and table_name in ('organizations', 'organization_members', 'organization_invitations', 'organization_credit_movements')),
    0::bigint, 'the browser holds no right on any of these tables');
select is(
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('organizations', 'organization_members', 'organization_invitations', 'organization_credit_movements') and relrowsecurity),
    4::bigint, 'and each has its row security on');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000a0002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok('select * from organizations', '42501', null, 'a client does not read organizations');
select throws_ok('select * from organization_invitations', '42501', null, 'nor the invitations to a team');
select throws_ok('select * from organization_credit_movements', '42501', null, 'nor its credit');
select results_eq('select user_id from workspace_members where workspace_id = 990202', array['00000000-0000-0000-0000-0000000a0002'::uuid], 'a client reads their own membership, never a staff row');
with touched as (update workspaces set organization_id = null where id = 990202 returning 1)
select is((select count(*) from touched), 0::bigint, 'nor takes the workspace out of its organization');
reset role;

set local role anon;
select throws_ok('select * from organizations', '42501', null, 'a visitor does not read organizations');
reset role;

set local role service_role;
select is((select count(*) from organizations where slug = 'nordlys'), 1::bigint, 'the service role does');
reset role;

select * from finish();
rollback;
