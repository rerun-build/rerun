-- The credit an organization bought and how it handed it out to its workspaces. Append-only ledger:
-- the balance of its reserve is `balance_after` of the last row. `seq` is unique per organization, so
-- two movements written at once from the same balance cannot both land.
create table public.organization_credit_movements (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete restrict,
    seq integer not null check (seq > 0),
    kind text not null check (kind in ('purchase', 'adjustment', 'allocation', 'take_back')),
    -- The effect on the reserve: an allocation takes from it, a take back returns to it. Bounded by
    -- what JavaScript reads exactly.
    micros bigint not null check (micros <> 0 and abs(micros) <= 9007199254740991),
    balance_after bigint not null check (balance_after between 0 and 9007199254740991),
    workspace_id bigint references public.workspaces(id) on delete set null,
    -- As it was called then: the history outlives the workspace.
    workspace_name text,
    actor_user_id uuid references public.users(id) on delete set null,
    note text check (char_length(note) <= 500),
    -- Drawn by the screen once per intent, so a double click or a retry lands once.
    request_id uuid not null unique,
    -- When an allocation reached its workspace. Claimed before the credit is granted, so it is
    -- granted once.
    applied_at timestamptz,
    -- The allocation this movement undoes, when it could not reach its workspace.
    reversal_of uuid unique references public.organization_credit_movements(id),
    created_at timestamptz not null default now(),
    unique (organization_id, seq),
    check (case kind when 'purchase' then micros > 0 when 'allocation' then micros < 0 when 'take_back' then micros > 0 else true end)
);

create index organization_credit_movements_workspace_idx on public.organization_credit_movements (workspace_id) where workspace_id is not null;

alter table public.organization_credit_movements enable row level security;
revoke all on table public.organization_credit_movements from anon, authenticated;
grant all on table public.organization_credit_movements to service_role;
