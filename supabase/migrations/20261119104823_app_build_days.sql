-- Who runs which build of the mobile app: one row per person, platform, build and day, written by the
-- hub the first time that day a build calls /api/v1 (the `x-rerun-client` header). A build is retired
-- (its minimum raised, its contract dropped) only once nobody runs it any more; the notifications'
-- device_tokens only knew the people who accepted pushes.
create table if not exists "public"."app_build_days" (
    "day" date not null,
    "platform" text not null check ("platform" in ('ios', 'android')),
    "build" integer not null check ("build" >= 0),
    "version" text not null,
    "user_id" uuid not null references auth.users (id) on delete cascade,
    primary key ("day", "platform", "build", "user_id")
);

create index if not exists "app_build_days_user_idx" on "public"."app_build_days" ("user_id");

alter table "public"."app_build_days" enable row level security;

grant select, insert, update, delete on table "public"."app_build_days" to service_role;

-- Each build seen since `p_since`: how many people ran it, and the last day one did.
create or replace function public.app_build_usage(p_since date)
returns table (platform text, build integer, version text, people bigint, last_day date)
language sql
stable
security invoker
set search_path = ''
as $$
    select d.platform, d.build, max(d.version), count(distinct d.user_id), max(d.day)
    from public.app_build_days d
    where d.day >= p_since
    group by d.platform, d.build
    order by d.platform, d.build desc
$$;

revoke execute on function public.app_build_usage(date) from public, anon, authenticated;
grant execute on function public.app_build_usage(date) to service_role;
