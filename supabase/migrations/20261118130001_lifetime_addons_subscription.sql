-- A lifetime workspace has no plan subscription, so its LinkedIn and WhatsApp slots live on a second
-- Stripe subscription that carries nothing but them. It never goes in `stripe_subscription_id`: that
-- one's status decides whether the machine runs, and giving back a slot must not power a lifetime box
-- off.
--
-- `stripe_addons_subscription_id` is never cleared once set: non-null also means the free trial of the
-- first slot has been used. `addons_current_period_end` tells a renewal from a mid-period change, so a
-- slot given back is held until the period it was paid for ends.
alter table public.workspaces
    add column if not exists stripe_addons_subscription_id text,
    add column if not exists addons_current_period_end timestamptz;
