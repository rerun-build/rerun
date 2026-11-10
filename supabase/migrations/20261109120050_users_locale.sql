-- The language an account picked for the app, its emails and its notifications. Null follows the
-- browser (Accept-Language), which is what every account does until it picks one. A short BCP 47
-- tag, the same shape as LOCALE_TAG_PATTERN in packages/i18n/src/locales.ts.
alter table public.users
    add column if not exists locale text;

alter table public.users
    drop constraint if exists users_locale_format;

alter table public.users
    add constraint users_locale_format check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$');
