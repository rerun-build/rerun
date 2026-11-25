-- The key that opens a person's support conversation (Crisp's CRISP_TOKEN_ID) on every device they sign
-- in from. Whoever holds it reads that conversation: one per person, random, and only the hub reads it,
-- with the service role.
create table public.user_support_tokens (
    user_id uuid primary key references public.users(id) on delete cascade,
    token uuid not null default gen_random_uuid() unique,
    created_at timestamptz not null default now()
);

alter table public.user_support_tokens enable row level security;
revoke all on table public.user_support_tokens from anon, authenticated;
grant all on table public.user_support_tokens to service_role;
