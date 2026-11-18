-- `notifications_workspace_event_created_idx (workspace_id, event, created_at desc)` leads on
-- `workspace_id`, so it serves every read the single-column index did. Kept, the old one was only
-- one more index to maintain on each notification written.
drop index if exists public.notifications_workspace_idx;
