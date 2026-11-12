-- The mobile app sells the plan through the store it was installed from: Apple In-App Purchase on
-- iOS, Google Play Billing on Android. The store's subscription fills the same columns the Stripe
-- webhook fills (subscription_status, trial_ends_at, current_period_end, ...), so the entitlement,
-- the teardown and the limits read one shape whoever bills the workspace. These columns say who
-- does, and tie the store's subscription back to its workspace.
--
-- billing_provider stays null until a workspace is billed by anyone, and is `stripe` for every
-- workspace that already has a Stripe subscription.
--
-- store_subscription_id is the store's stable id of the subscription: Apple's originalTransactionId,
-- Google's purchaseToken. store_account_token is the uuid the app hands to the purchase
-- (appAccountToken on iOS, obfuscatedAccountId on Android), which the store gives back on every
-- transaction and notification. store_environment is where the store answered from
-- (Production / Sandbox for Apple, production / test for Google).
alter table public.workspaces
    add column if not exists billing_provider text,
    add column if not exists store_subscription_id text,
    add column if not exists store_account_token uuid,
    add column if not exists store_environment text;

alter table public.workspaces drop constraint if exists workspaces_billing_provider_check;
alter table public.workspaces
    add constraint workspaces_billing_provider_check check (billing_provider in ('stripe', 'apple', 'google'));

create unique index if not exists workspaces_store_subscription_id_key
    on public.workspaces (store_subscription_id) where store_subscription_id is not null;

create unique index if not exists workspaces_store_account_token_key
    on public.workspaces (store_account_token) where store_account_token is not null;

-- The hourly sweep reads the store workspaces whose period is over or about to be.
create index if not exists workspaces_store_period_idx
    on public.workspaces (current_period_end) where billing_provider in ('apple', 'google');

update public.workspaces
set billing_provider = 'stripe'
where billing_provider is null and stripe_subscription_id is not null;

-- A store notification is handled once, like a Stripe event (stripe_events): Apple's
-- notificationUUID, the Pub/Sub messageId of a Google Play notification. The row is claimed before
-- the handler runs and stamped once it succeeded, so a redelivery of a handled notification is
-- dropped and the retry of a failed one runs again.
create table if not exists public.store_notifications (
    provider text not null check (provider in ('apple', 'google')),
    notification_id text not null,
    type text not null,
    claimed_at timestamptz not null default now(),
    processed_at timestamptz,
    payload jsonb,
    primary key (provider, notification_id)
);

create index if not exists store_notifications_unprocessed_idx
    on public.store_notifications (claimed_at) where processed_at is null;

alter table public.store_notifications enable row level security;

-- Service role only: no policy, and none of the default grants Supabase hands to new tables.
revoke all on table public.store_notifications from anon, authenticated;
grant all on table public.store_notifications to service_role;
