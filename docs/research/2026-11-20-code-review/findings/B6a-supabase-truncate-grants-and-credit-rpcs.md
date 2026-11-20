# `B6a`: Baseline Supabase Migrations Grant `TRUNCATE` to `anon` and `authenticated` on 21 Live Tables (Bypassing RLS) and Leave `grant_rerun_topup` / `consume_rerun_credit` Callable via RPC

- **Finding:** While `20260812122529_revoke_billing_table_defaults.sql` explicitly noted that *"Row level security does not cover truncate"* and revoked `anon`/`authenticated` defaults on 4 billing tables, 21 remaining baseline tables (including `workspaces`, `agents`, `engine_pool`, `api_keys`, `sessions`, `spaces`, and `workspace_members`) still retain `GRANT TRUNCATE ... TO anon, authenticated` from `20260812121014_remote_schema.sql`, and `grant_rerun_topup` / `consume_rerun_credit` are never revoked from `PUBLIC` (`anon`/`authenticated`).

## Evidence

- `supabase/migrations/20260812122529_revoke_billing_table_defaults.sql:1-10`:
  ```sql
  -- Supabase grants every privilege to anon and authenticated on any table created in public, and a
  -- schema dump records the grants that remain rather than the revokes that removed them. These four
  -- tables were stripped of that default on production, so a database rebuilt from the baseline hands
  -- back truncate on the billing history to a role that holds nothing but the publishable key. Row
  -- level security does not cover truncate.

  revoke all on table public.creator_accounts from anon, authenticated;
  revoke all on table public.stripe_events from anon, authenticated;
  revoke all on table public.template_purchases from anon, authenticated;
  revoke all on table public.template_sales from anon, authenticated;
  ```
- `supabase/migrations/20260812121014_remote_schema.sql:1184,1198,1226,1240,2190,2204` (and 18 other live tables — never revoked in any subsequent migration):
  ```sql
  grant truncate on table "public"."agents" to "anon";
  grant truncate on table "public"."agents" to "authenticated";
  grant truncate on table "public"."api_keys" to "anon";
  grant truncate on table "public"."api_keys" to "authenticated";
  ...
  grant truncate on table "public"."engine_pool" to "anon";
  grant truncate on table "public"."engine_pool" to "authenticated";
  ...
  grant truncate on table "public"."workspaces" to "anon";
  grant truncate on table "public"."workspaces" to "authenticated";
  ```
- `supabase/migrations/20260812121014_remote_schema.sql:1050-1068`:
  ```sql
  CREATE OR REPLACE FUNCTION public.current_workspace_ids()
   RETURNS SETOF bigint
   LANGUAGE sql
   STABLE SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
      select workspace_id from public.workspace_members where user_id = auth.uid()
  $function$
  ;

  CREATE OR REPLACE FUNCTION public.grant_rerun_topup(p_workspace_id bigint, p_micros bigint)
   RETURNS void
   LANGUAGE sql
  AS $function$
      update workspaces set rerun_topup_micros = rerun_topup_micros + p_micros where id = p_workspace_id;
  $function$
  ;
  ```
- `supabase/migrations/20260812121014_remote_schema.sql:1940-1950` vs `20260812121424_column_level_grants.sql:10-12`:
  ```sql
  grant delete on table "public"."spaces" to "anon";
  grant insert on table "public"."spaces" to "anon";
  grant select on table "public"."spaces" to "anon";
  grant truncate on table "public"."spaces" to "anon";
  grant update on table "public"."spaces" to "anon";
  ```
- **Command / test run:** Python chronological privilege audit across all 135 files in `supabase/migrations/*.sql`:
  ```text
  TABLES COUNT: 74 (74/74 have ENABLE ROW LEVEL SECURITY)
  ROLE anon STILL HAS TRUNCATE ON (21 live tables): ['agents', 'api_keys', 'blocked_email_domains', 'blog_posts', 'connector_requests', 'engine_pool', 'expert_email_opt_outs', 'expert_hire_requests', 'experts', 'invitation_codes', 'invitation_redemptions', 'notifications', 'published_files', 'rerun_usage_events', 'services', 'sessions', 'spaces', 'templates', 'workspace_invitations', 'workspace_members', 'workspaces']
  ROLE authenticated STILL HAS TRUNCATE ON (21 live tables): [same 21 tables]
  ```

## Trigger

*(What holds: Every single one of the 74 tables in `packages/db/src/database.types.ts` has `ENABLE ROW LEVEL SECURITY` enabled, `engine_pool`, `api_keys`, `desktop_auth_codes`, `oauth_pending_grants`, `sign_in_codes`, and `agent_shares` have zero `SELECT`/`UPDATE`/`INSERT`/`DELETE` policies so row-level PostgREST `GET`/`PATCH`/`DELETE` returns 0 rows, and all `SECURITY DEFINER` functions except `current_workspace_ids()` and `rls_auto_enable()` have `SET search_path` and `REVOKE ... FROM public`.)*

However, on any database built or migrated from `supabase/migrations/` (including every self-hosted install running `deploy/vps/update.sh` `supabase db push` and CI `supabase db reset`):
1. **`TRUNCATE` granted to `anon` and `authenticated` on 21 core tables:** PostgreSQL `TRUNCATE` is a table-level privilege that **completely bypasses Row Level Security**. While PostgREST itself does not expose a REST verb for `TRUNCATE`, any `SECURITY INVOKER` SQL/PLpgSQL function, GraphQL/pg_net extension, or future RPC reachable by `anon`/`authenticated` holds PostgreSQL permission to `TRUNCATE public.workspaces CASCADE` — and `20260812122529_revoke_billing_table_defaults.sql` already documented this exact hazard on 4 tables while leaving the other 21 live baseline tables unrevoked!
2. **`grant_rerun_topup` / `consume_rerun_credit` `PUBLIC` `EXECUTE` + `workspaces` table-level `SELECT`/`UPDATE` grants:** PostgreSQL grants `EXECUTE` on functions to `PUBLIC` (`anon` and `authenticated`) by default, and neither `grant_rerun_topup(bigint, bigint)` nor `consume_rerun_credit(bigint, bigint)` has a `REVOKE EXECUTE ... FROM public, anon, authenticated`. Today `workspaces` has no `FOR UPDATE` RLS policy (`20261009120000_workspace_price_arm.sql:7`), which silently turns `POST /rest/v1/rpc/grant_rerun_topup` by an authenticated user into a 0-row no-op rather than an immediate `42501 permission denied`, and `workspaces` still grants table-wide `SELECT` (including `stripe_customer_id`, `stripe_subscription_id`, `price_arm` for the user's own workspace) despite comments in `20260910143100_trial_card_fingerprints.sql:9` assuming `workspaces` had column-level grants!

## Impact and severity

- **Severity:** `medium` (High if any RPC/extension path invokes `TRUNCATE` or if a `FOR UPDATE` policy is ever added to `workspaces`, which would immediately allow any user to call `POST /rest/v1/rpc/grant_rerun_topup` to mint unlimited credits!)
- **Impact:** Excessive table-level `TRUNCATE`/`DELETE`/`UPDATE` privileges on 21 core tables for `anon` and `authenticated`, unrevoked billing RPCs (`grant_rerun_topup`, `consume_rerun_credit`), and full-row `SELECT` on `workspaces` exposing internal billing metadata (`stripe_customer_id`, `stripe_subscription_id`, `price_arm`) to workspace members via browser PostgREST.

## Proposed fix

- **Smallest causal change (new migration `supabase/migrations/20261120120000_revoke_baseline_truncate_and_credit_rpcs.sql`):**
  ```sql
  revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
  revoke delete, insert, update on table
      public.api_keys,
      public.blocked_email_domains,
      public.blog_posts,
      public.connector_requests,
      public.engine_box_metrics,
      public.engine_host_metrics,
      public.engine_hosts,
      public.engine_pool,
      public.expert_email_opt_outs,
      public.expert_hire_requests,
      public.invitation_codes,
      public.invitation_redemptions,
      public.published_files,
      public.rerun_usage_events,
      public.workspace_invitations,
      public.workspace_members,
      public.workspaces
  from anon, authenticated;
  revoke select on table
      public.api_keys,
      public.engine_box_metrics,
      public.engine_host_metrics,
      public.engine_hosts,
      public.engine_pool
  from anon, authenticated;
  revoke all on function public.consume_rerun_credit(bigint, bigint) from public, anon, authenticated;
  revoke all on function public.grant_rerun_topup(bigint, bigint) from public, anon, authenticated;
  grant execute on function public.consume_rerun_credit(bigint, bigint) to service_role;
  grant execute on function public.grant_rerun_topup(bigint, bigint) to service_role;
  revoke all on function public.current_workspace_ids() from public, anon;
  ```
- **Must not break:** Browser Realtime subscriptions and client `select*` reads on `spaces`, `agents`, `sessions`, `notifications`, `workspace_members`, `workspaces` (`SELECT` stays granted to `authenticated`), and catalog `SELECT` on `templates`, `services`, `experts`, `blog_posts`, `changelog_entries` for `anon`/`authenticated`.
- **Failing test that proves the fix:**
  - **File:** `supabase/tests/space_access.test.sql`
  - **Test name:** pgTAP assertions `hasnt_table_privilege('anon', 'public.workspaces', 'TRUNCATE')`, `hasnt_table_privilege('authenticated', 'public.engine_pool', 'SELECT')`, and `throws_ok($$ select public.grant_rerun_topup(990001, 1000000) $$, '42501', ...)`
  - **Assertion:** Under `set local role authenticated`, assert `has_table_privilege('authenticated', 'public.workspaces', 'TRUNCATE')` is `false` and `select public.grant_rerun_topup(...)` raises `42501` (`permission denied for function grant_rerun_topup`).
- **Alternative fix and trade-off:** Also replace table-wide `SELECT` on `public.workspaces` with an explicit column-level `GRANT SELECT (id, name, icon_url, plan, locale, ...)` omitting `stripe_customer_id`, `stripe_subscription_id`, and `price_arm`, matching `public.spaces` (`20260812121424`). Requires checking every client column selection in `SessionProvider.tsx` first so no client query fails with `42501`.

## Confidence

`proven` (on fresh installs / self-hosted `supabase db push`; production dashboard manual revokes outside git are `unproven` without querying `information_schema.role_table_grants` on production, which is out of scope).
