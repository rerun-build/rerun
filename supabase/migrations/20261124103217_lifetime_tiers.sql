-- The lifetime deal is sold in three tiers. What a workspace may do is on the workspace itself
-- (max_seats, api_access): the tier says which values it was given, and support can still adjust one
-- by hand. Null = no tier, everything open, which is what every lifetime workspace sold so far keeps.
alter table public.workspaces
    add column api_access boolean not null default true,
    add column lifetime_tier smallint check (lifetime_tier between 1 and 3),
    add column lifetime_purchase_id uuid;

-- The workspaces one purchase covers share this id: a tier change reaches all of them, and they are
-- counted against what the tier allows.
create index workspaces_lifetime_purchase_id_idx on public.workspaces (lifetime_purchase_id) where lifetime_purchase_id is not null;

-- A stackable code opens the first tier, and each one added to the same workspace raises it by one.
-- The codes already handed out are not: each opens the whole lifetime plan.
alter table public.invitation_codes add column stackable boolean not null default false;
