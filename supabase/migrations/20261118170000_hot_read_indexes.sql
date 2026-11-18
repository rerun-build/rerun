-- Three reads that walked a whole table for a handful of recent rows.

-- The lifecycle sweep reads the runs of the last 14 days, newest first, every 15 minutes. Nothing
-- was ordered on `created_at`, so each page sorted every notification ever written.
create index if not exists notifications_agent_created_idx on public.notifications (created_at desc) where agent_id is not null;

-- "Was this workspace already told its budget ran out?", asked on every refused call. Only
-- `workspace_id` was indexed: the read went through every notification of the workspace.
create index if not exists notifications_workspace_event_created_idx on public.notifications (workspace_id, event, created_at desc);

-- The box watchdog and `engine_box_disk_latest` read the samples of the last minutes across every
-- host. Both indexes of the table lead on `host_id`, which neither read names.
create index if not exists engine_box_metrics_sampled_idx on public.engine_box_metrics (sampled_at);
