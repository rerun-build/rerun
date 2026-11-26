-- Two-step verification (RER-379). The factors themselves are Supabase's (auth.mfa_factors): an
-- authenticator app (TOTP) and passkeys (WebAuthn). What Supabase has no place for lives here, only the
-- hub reads it with the service role, and the browser never sees it: the column privileges of
-- 20261125170000_users_support_token.sql leave a new column of public.users out of what `authenticated`
-- may select.
--   recovery: the hidden TOTP factor the hub signs in with when a backup code is spent or the desktop
--             app opens its session, its secret sealed with a key of the hub
--   codes:    the backup codes, hashed, each with the time it was spent
--   names:    the names given to the passkeys, by factor id (Supabase cannot rename a factor)
alter table public.users add column two_step jsonb;

-- The sessions a person has open, for the "Where you're signed in" list. auth is not exposed over
-- PostgREST, so the hub reads them through this view, with the service role only. A plain view on one
-- table is updatable: deleting a row signs that session out (its refresh tokens go with it).
create view public.auth_sessions as
    select id, user_id, created_at, updated_at, refreshed_at, user_agent, aal, not_after
    from auth.sessions;

revoke all on table public.auth_sessions from anon, authenticated;
grant select, delete on table public.auth_sessions to service_role;
