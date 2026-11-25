-- The domains an organization serves the app on, besides `<slug>.<root domain>`, which it always has
-- and which takes no row.
create table public.organization_domains (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- Lowercase, in ASCII (punycode), without a port, a path nor a trailing dot.
    hostname text not null check (hostname = lower(hostname) and char_length(hostname) between 3 and 253 and hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
    -- `active` alone is served. An `error` was served once, and its DNS stopped pointing here.
    status text not null default 'pending' check (status in ('pending', 'active', 'error')),
    -- What the DNS of the domain has to publish: whoever points a domain here is not whoever says so in
    -- a console.
    verification_token text not null,
    -- What the last check found wrong, as a code the console words.
    problem text,
    -- Since when an active domain no longer points here. It stays served for a day.
    failing_since timestamptz,
    verified_at timestamptz,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    unique (organization_id, hostname)
);

-- Anyone may ask for a domain; the first to prove it has it, and nobody else until they let it go.
create unique index organization_domains_active_uniq on public.organization_domains (hostname) where status = 'active';
create index organization_domains_status_idx on public.organization_domains (status, last_checked_at);

alter table public.organization_domains enable row level security;
revoke all on table public.organization_domains from anon, authenticated;
grant all on table public.organization_domains to service_role;
