-- What the before_user_created hook lets through (migration 20261118120000): no anonymous user, no
-- account created by the public email signup, no blocked domain; Google, Apple and the accounts the
-- server creates go through. Runs with `pnpm exec supabase test db` on the local stack; everything
-- is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(6);

insert into public.blocked_email_domains (domain) values ('blocked.rerun.test') on conflict do nothing;

select is(
    public.before_user_created('{"user": {"is_anonymous": true, "app_metadata": {}}}'::jsonb) -> 'error' ->> 'http_code',
    '403',
    'an anonymous user is refused'
);

select is(
    public.before_user_created('{"user": {"app_metadata": {"provider": "anonymous"}}}'::jsonb) -> 'error' ->> 'http_code',
    '403',
    'an anonymous provider is refused even without the flag'
);

select is(
    public.before_user_created('{"user": {"email": "ada@rerun.test", "app_metadata": {"provider": "email"}}}'::jsonb) -> 'error' ->> 'http_code',
    '403',
    'the public email signup is still refused'
);

select is(
    public.before_user_created('{"user": {"email": "ada@blocked.rerun.test", "is_anonymous": false, "app_metadata": {"provider": "google"}}}'::jsonb) -> 'error' ->> 'http_code',
    '400',
    'a blocked domain is still refused'
);

select is(
    public.before_user_created('{"user": {"email": "ada@rerun.test", "is_anonymous": false, "app_metadata": {"provider": "google"}}}'::jsonb),
    '{}'::jsonb,
    'a Google account goes through'
);

select is(
    public.before_user_created('{"user": {"email": "ada@rerun.test", "app_metadata": {"provider": "apple"}}}'::jsonb),
    '{}'::jsonb,
    'an Apple account without the flag goes through'
);

select * from finish();
rollback;
