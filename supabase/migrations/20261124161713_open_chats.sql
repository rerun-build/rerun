-- The threads each person left open on a coworker, the same on all their devices. Only the hub reads
-- and writes them, with the service role.
create table public.open_chats (
    user_id uuid not null references public.users(id) on delete cascade,
    session_id uuid not null references public.sessions(id) on delete cascade,
    agent_id uuid not null references public.agents(id) on delete cascade,
    opened_at timestamptz not null default now(),
    primary key (user_id, session_id)
);

create index open_chats_user_agent_idx on public.open_chats (user_id, agent_id, opened_at);
create index open_chats_session_idx on public.open_chats (session_id);
create index open_chats_agent_idx on public.open_chats (agent_id);

-- The conversation each person picked last on a coworker (null: its General), and the device it was
-- picked on: another device offers it.
create table public.open_chat_states (
    user_id uuid not null references public.users(id) on delete cascade,
    agent_id uuid not null references public.agents(id) on delete cascade,
    active_session_id uuid references public.sessions(id) on delete set null,
    device_id uuid not null,
    device_kind text not null check (device_kind in ('computer', 'phone')),
    changed_at timestamptz not null default now(),
    primary key (user_id, agent_id)
);

create index open_chat_states_agent_idx on public.open_chat_states (agent_id);
create index open_chat_states_session_idx on public.open_chat_states (active_session_id);

alter table public.open_chats enable row level security;
revoke all on table public.open_chats from anon, authenticated;
grant all on table public.open_chats to service_role;

alter table public.open_chat_states enable row level security;
revoke all on table public.open_chat_states from anon, authenticated;
grant all on table public.open_chat_states to service_role;
