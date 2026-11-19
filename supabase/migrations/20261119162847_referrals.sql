-- Refer a friend: a member's link (`/i/<code>`) brings a new account, and when that account's
-- workspace pays its first plan invoice both workspaces get a month of the plan off as a negative plan
-- invoice line. A code belongs to one member of one workspace, a referral to the account it brought.
-- Each side's `*_credit_cents` is written as soon as Stripe took it, so a replayed `invoice.paid`
-- only does what is left; `rewarded_at` is set once both sides are settled.
-- `referrer_credit_cents` is 0 when the referrer got nothing: its cap reached, or no plan left.
-- Service-role only.

create table public.referral_codes (
    code text primary key,
    workspace_id bigint not null references public.workspaces (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (workspace_id, user_id)
);

create table public.referrals (
    id uuid primary key default gen_random_uuid(),
    code text not null references public.referral_codes (code) on delete cascade,
    referrer_workspace_id bigint not null references public.workspaces (id) on delete cascade,
    referrer_user_id uuid not null references auth.users (id) on delete cascade,
    referee_user_id uuid not null unique references auth.users (id) on delete cascade,
    referee_workspace_id bigint not null references public.workspaces (id) on delete cascade,
    created_at timestamptz not null default now(),
    rewarded_at timestamptz,
    referee_credit_cents integer check (referee_credit_cents > 0),
    referrer_credit_cents integer check (referrer_credit_cents >= 0),
    check (referrer_workspace_id <> referee_workspace_id)
);

create index referrals_referrer_workspace_id_idx on public.referrals (referrer_workspace_id);
create index referrals_referee_workspace_id_idx on public.referrals (referee_workspace_id);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
-- RLS does not cover truncate, and Supabase's default privileges hand it to anon on every new table.
revoke all on table public.referral_codes from anon, authenticated;
revoke all on table public.referrals from anon, authenticated;
grant select, insert, update, delete on table public.referral_codes to service_role;
grant select, insert, update, delete on table public.referrals to service_role;
