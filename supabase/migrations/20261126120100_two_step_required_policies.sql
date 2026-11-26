-- Two-step verification (RER-379), in the database too. A person who turned it on and signed in with
-- their first method only holds an aal1 token: the hub takes such a session for nobody, and these
-- policies do the same for whatever reaches PostgREST or Realtime with that token. Restrictive, so they
-- narrow every permissive policy of the table and open nothing. They read the token alone: the flag
-- the hub writes in app_metadata (see apps/ui/lib/auth/two-step/gate.ts), and the session's level.
-- The service role skips row level security, as always. A new table with row level security gets the
-- same policy (apps/ui/lib/auth/two-step/rls.test.ts checks it). The security definer functions, which
-- these policies do not reach, carry the same condition: 20261126120200_two_step_required_functions.sql.

create policy two_step_required on public.agent_shares as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.agents as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.api_keys as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.app_build_days as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.app_connection_agents as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.app_connections as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.app_trial_claims as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.app_usage_counters as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.app_webhook_events as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.blocked_email_domains as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.blog_posts as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.changelog_entries as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.connector_requests as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.creator_accounts as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.desktop_auth_codes as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.device_tokens as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.email_sign_up_limits as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.engine_box_metrics as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.engine_host_metrics as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.engine_hosts as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.engine_pairing_tokens as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.engine_pool as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.expert_email_opt_outs as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.expert_hire_requests as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.experts as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.feature_requests as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.foreman_builds as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.foreman_conversations as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.invitation_codes as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.invitation_redemptions as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.lifecycle_emails as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.message_feedback as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.newsletter_recipients as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.newsletter_sends as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.notification_email_dispatches as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.notification_email_suppressions as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.notification_incidents as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.notification_push_dispatches as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.notifications as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.oauth_pending_grants as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.open_chat_states as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.open_chats as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.organization_credit_movements as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.organization_domains as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.organization_invitations as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.organization_members as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.organizations as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.paid_data_events as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.phone_sign_in_send_limits as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.phone_sign_in_sends as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.published_access_codes as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.published_files as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.published_gate_attempts as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.referral_codes as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.referrals as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.remote_computers as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.rerun_credit_purchases as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.rerun_usage_events as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.service_alternatives as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.services as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.session_participants as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.session_reads as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.sessions as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.sign_in_codes as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.space_members as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.spaces as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.stripe_events as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.template_purchases as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.template_sales as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.templates as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.trial_card_fingerprints as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.user_phones as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.user_presence as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.users as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.web_fetch_events as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.web_search_cache as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.web_search_events as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.whatsapp_messages as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspace_apps as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspace_archives as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspace_backups as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspace_getting_started as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspace_invitations as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspace_members as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspace_onboarding as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');

create policy two_step_required on public.workspaces as restrictive for all to authenticated
    using (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2')
    with check (coalesce((select auth.jwt()) -> 'app_metadata' ->> 'two_step', 'false') <> 'true' or (select auth.jwt()) ->> 'aal' = 'aal2');
