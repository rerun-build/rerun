-- A one-off scheduled task now deletes itself once its run succeeds, so the inbox and the board can
-- no longer name its unseen run after the engine's schedule: `unseen_runs` hands back the routine's
-- name the session keeps (`automation_name`). The return type changes, so the function is dropped and
-- created again, the rest of it word for word from 20261119094317.
--
-- A change to the select policy of `notifications` or `sessions` has to be carried here too.
do $migration$
declare
    floor_pattern constant text := 'coalesce\(r\.seen_at, ''([^'']+)''::timestamp';
    floor_literal text := substring(pg_get_functiondef('public.unseen_runs(integer)'::regprocedure) from floor_pattern);
begin
    if floor_literal is null then
        raise exception 'unseen_runs: no floor found in the current definition';
    end if;

    drop function public.unseen_runs(integer);

    execute format($fn$
        create function public.unseen_runs(p_workspace_id integer)
        returns table (session_id uuid, agent_id uuid, title text, source public.session_source, slug text, message text, last_at timestamptz, run_count integer, automation_name text)
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
                count(*)::integer,
                s.automation_name
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
