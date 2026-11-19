-- unseen_runs read every finished run of the workspace to keep the caller's: 32,000 rows for 750 in
-- the largest workspace, 210 ms a call on a copy of production, a quarter of the database's time.
-- The recipient test (`recipients ? uid`) could not use an index: under RLS, Postgres only lets an
-- index serve an operator marked leakproof, and jsonb's `?` is not. So the function now runs as its
-- owner and writes the three policies it relied on into its own query, word for word:
-- notifications (workspace, visible coworker, visible Box), sessions (visible coworker, the one of
-- the notification) and session_reads (the caller's own). In plpgsql, so the session keeps its plan
-- between calls. Through the index: 22 ms, 6,200 blocks instead of 42,000. Same signature, same rows.
--
-- A change to the select policy of `notifications` or `sessions` has to be carried here too.
create index if not exists notifications_done_recipients_idx on public.notifications using gin (recipients) where kind = 'done';

-- The floor written into the function by 20261020160000 is the moment that migration ran. It is
-- carried over as it is: a new floor would light up, or hide, every run finished since.
do $migration$
declare
    floor_pattern constant text := 'coalesce\(r\.seen_at, ''([^'']+)''::timestamp';
    floor_literal text := substring(pg_get_functiondef('public.unseen_runs(integer)'::regprocedure) from floor_pattern);
begin
    if floor_literal is null then
        raise exception 'unseen_runs: no floor found in the current definition';
    end if;

    execute format($fn$
        create or replace function public.unseen_runs(p_workspace_id integer)
        returns table (session_id uuid, agent_id uuid, title text, source public.session_source, slug text, message text, last_at timestamptz, run_count integer)
        language plpgsql
        stable
        security definer
        set search_path = public
        as $body$
        begin
            return query
            select
                s.id,
                s.agent_id,
                s.title,
                s.source,
                (array_agg(coalesce(n.metadata ->> 'scheduleSlug', n.metadata ->> 'triggerSlug') order by n.created_at desc))[1],
                (array_agg(n.message order by n.created_at desc))[1],
                max(n.created_at),
                count(*)::integer
            from public.notifications n
            join public.sessions s on s.agent_id = n.agent_id and s.engine_session_id = n.engine_session_id
            left join public.session_reads r on r.session_id = s.id and r.user_id = auth.uid()
            where n.workspace_id = p_workspace_id
              and n.kind = 'done'
              and n.recipients ? auth.uid()::text
              and n.created_at > coalesce(r.seen_at, %L::timestamptz)
              and p_workspace_id in (select public.current_workspace_ids())
              and n.agent_id in (select public.visible_agent_ids())
              and (n.space_id is null or n.space_id in (select public.visible_space_ids()))
            group by s.id
            order by max(n.created_at) desc
            limit 500;
        end
        $body$
    $fn$, floor_literal);

    if substring(pg_get_functiondef('public.unseen_runs(integer)'::regprocedure) from floor_pattern) is distinct from floor_literal then
        raise exception 'unseen_runs: the floor changed while rewriting the function';
    end if;
end
$migration$;

revoke all on function public.unseen_runs(integer) from public, anon;
grant execute on function public.unseen_runs(integer) to authenticated;
