-- The language the workspace's coworkers write in when nobody is talking to them (a schedule, a
-- trigger). A new workspace takes the language of whoever created it; the ones before this column
-- start in English. Same tag shape as users.locale.
alter table public.workspaces
    add column if not exists locale text not null default 'en';

alter table public.workspaces
    drop constraint if exists workspaces_locale_format;

alter table public.workspaces
    add constraint workspaces_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$');
