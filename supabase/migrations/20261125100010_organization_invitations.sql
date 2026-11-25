-- Who an organization asked to join its team. Never read by the browser: the token of a pending
-- invitation lets its reader in.
create table public.organization_invitations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    email text not null,
    role text not null check (role in ('owner', 'admin')),
    token text not null unique,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
    invited_by uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    accepted_at timestamptz
);

create unique index organization_invitations_pending_uniq on public.organization_invitations (organization_id, lower(email)) where status = 'pending';

alter table public.organization_invitations enable row level security;
revoke all on table public.organization_invitations from anon, authenticated;
grant all on table public.organization_invitations to service_role;
