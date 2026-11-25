-- The key that opens a person's support conversation (Crisp's CRISP_TOKEN_ID) on every device they sign
-- in from. Only the hub reads it, with the service role. Null once the account is deleted.
alter table public.users add column support_token uuid default gen_random_uuid();

-- Column privileges: the browser reads every column of its own row but this one, over PostgREST and
-- realtime alike. A column added to public.users later is hidden from the browser until it is granted.
revoke select on table public.users from authenticated;
grant select (id, created_at, workspace_id, verified, onboarding_answers, onboarding_completed_at, email_notification_prefs, account_role, expert_profile_id, signed_up_at, changelog_seen_at, deleted_at, locale) on table public.users to authenticated;
