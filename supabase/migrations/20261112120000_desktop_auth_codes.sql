-- The desktop app signs in through the system browser: the browser, signed in on the web, mints a
-- one-time code here and hands it back to the app through its URL scheme; the app spends it, with the
-- PKCE verifier only it holds, for a session of its own. The code itself is never stored, only its
-- SHA-256. A code lives two minutes and is spent once (`used_at`), whoever presents it first.
-- Service-role only.

create table public.desktop_auth_codes (
    code_hash text primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    code_challenge text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at timestamptz
);

create index desktop_auth_codes_expires_at_idx on public.desktop_auth_codes (expires_at);

alter table public.desktop_auth_codes enable row level security;
-- RLS does not cover truncate, and Supabase's default privileges hand it to anon on every new table.
revoke all on table public.desktop_auth_codes from anon, authenticated;
grant select, insert, update, delete on table public.desktop_auth_codes to service_role;
