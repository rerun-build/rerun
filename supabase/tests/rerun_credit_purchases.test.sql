-- Rerun credit bought once (migration 20261114120000_rerun_credit_purchases): a payment grants its
-- credit once however many times it is reported, and a refund takes back only what is left. Runs with
-- `pnpm exec supabase test db` on the local stack; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(11);

insert into public.workspaces (id, icon_url, name, rerun_topup_micros) values (990101, '', 'Credit purchase test', 3500000);

select is(grant_rerun_credit_purchase(990101, 'pi_test_1', 2, 20000000), true, 'a new payment grants its credit');
select is((select rerun_topup_micros from workspaces where id = 990101), 23500000::bigint, 'the credit adds to what was left');
select is(grant_rerun_credit_purchase(990101, 'pi_test_1', 2, 20000000), false, 'the same payment reported again grants nothing');
select is((select rerun_topup_micros from workspaces where id = 990101), 23500000::bigint, 'the balance is unchanged by the replay');

select is(revoke_rerun_credit_purchase('pi_test_1', 10000000), 10000000::bigint, 'a partial refund takes back its share');
select is(revoke_rerun_credit_purchase('pi_test_1', 10000000), 0::bigint, 'the same refund reported again takes nothing');
select is(revoke_rerun_credit_purchase('pi_test_1', 20000000), 10000000::bigint, 'a second refund takes only the rest');
select is((select rerun_topup_micros from workspaces where id = 990101), 3500000::bigint, 'the purchase is fully taken back');

update workspaces set rerun_topup_micros = 1000000 where id = 990101;
select grant_rerun_credit_purchase(990101, 'pi_test_2', 1, 10000000);
update workspaces set rerun_topup_micros = 2000000 where id = 990101;
select is(revoke_rerun_credit_purchase('pi_test_2', 10000000), 10000000::bigint, 'a refund of credit already spent is recorded');
select is((select rerun_topup_micros from workspaces where id = 990101), 0::bigint, 'the balance never goes below zero');

select is(revoke_rerun_credit_purchase('pi_unknown', 10000000), 0::bigint, 'a refund of a payment that bought no credit takes nothing');

select * from finish();
rollback;
