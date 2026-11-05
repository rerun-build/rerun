-- A published link was always public. It now carries who may open it: anyone, the workspace's
-- members, anyone with a password, or the people it was shared with (emails and whole domains,
-- each confirmed by a code sent to the address). Every link published before keeps its public
-- access; a new one starts at 'workspace', the column default.
alter table public.published_files
    add column access text not null default 'workspace' check (access in ('public', 'workspace', 'password', 'invited')),
    add column invited text[] not null default '{}',
    add column password_hash text,
    -- 'public' when a coworker asked for it and the workspace policy kept the link to members until a
    -- person answers. Cleared once answered.
    add column requested_access text check (requested_access in ('public')),
    -- Bumped on every change of access: an access cookie names the version it was granted for.
    add column access_version integer not null default 1,
    add column title text,
    add column thumbnail_key text;

update public.published_files set access = 'public';

-- Who may make a link public. Null until the workspace picks one, which reads as the default the
-- app ships with.
alter table public.workspaces
    add column publish_policy text check (publish_policy in ('people', 'anyone', 'never'));

-- A code sent to an invited address. Only its hash is kept; the service role alone reads it.
create table public.published_access_codes (
    id uuid primary key default gen_random_uuid(),
    published_file_id uuid not null references public.published_files(id) on delete cascade,
    email text not null,
    code_hash text not null,
    attempts integer not null default 0,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index published_access_codes_lookup_idx on public.published_access_codes (published_file_id, email);

alter table public.published_access_codes enable row level security;

revoke all on table public.published_access_codes from anon, authenticated;
grant all on table public.published_access_codes to service_role;

-- Tries at a gate (a password typed, a code asked for or typed), counted per scope over a window.
create table public.published_gate_attempts (
    scope text primary key,
    attempt_count integer not null default 0,
    window_started_at timestamptz not null default now()
);

alter table public.published_gate_attempts enable row level security;

revoke all on table public.published_gate_attempts from anon, authenticated;
grant all on table public.published_gate_attempts to service_role;

-- Counts one try against every scope given, or answers false when one of them is already full. A
-- scope whose window has closed starts over. The try is counted first and compared after, so calls
-- fired together each see their own place in the window.
create or replace function public.claim_published_gate_attempt(p_scopes text[], p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_cutoff timestamptz := now() - make_interval(secs => p_window_seconds);
    v_scope text;
    v_count integer;
    v_allowed boolean := true;
begin
    delete from public.published_gate_attempts where window_started_at < v_cutoff;

    foreach v_scope in array p_scopes loop
        insert into public.published_gate_attempts (scope) values (v_scope) on conflict (scope) do nothing;
        update public.published_gate_attempts set attempt_count = attempt_count + 1 where scope = v_scope returning attempt_count into v_count;
        if v_count > p_max then
            v_allowed := false;
        end if;
    end loop;

    return v_allowed;
end;
$$;

revoke execute on function public.claim_published_gate_attempt(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.claim_published_gate_attempt(text[], integer, integer) to service_role;
