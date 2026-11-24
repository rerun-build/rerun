-- What a coworker drafted for the Rerun team (a feature Rerun lacks, an improvement, a bug of Rerun)
-- and the person sent, after editing it or not. Read by the team in the admin, never by the members:
-- only the service role touches it.
create table public.feature_requests (
    id uuid primary key default gen_random_uuid(),
    workspace_id bigint not null references public.workspaces(id) on delete cascade,
    user_id uuid references public.users(id) on delete set null,
    agent_id uuid references public.agents(id) on delete set null,
    session_id uuid references public.sessions(id) on delete set null,
    foreman_conversation_id uuid references public.foreman_conversations(id) on delete set null,
    -- The request_feature call the card answered: a second click on Send lands on the same row.
    tool_call_id text not null,
    kind text not null check (kind in ('feature', 'bug', 'improvement')),
    title text not null,
    description text not null,
    workaround text,
    -- HistoryMessage[] as the conversation stood when it was sent, since the Box holding it may be
    -- gone by the time the team reads it.
    transcript jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    unique (workspace_id, tool_call_id)
);

create index feature_requests_recent_idx on public.feature_requests (created_at desc);

alter table public.feature_requests enable row level security;
revoke all on table public.feature_requests from anon, authenticated;
grant all on table public.feature_requests to service_role;
