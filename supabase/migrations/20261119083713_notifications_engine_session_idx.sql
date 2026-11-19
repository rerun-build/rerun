-- The notifications of a conversation (the inbox, the attention list, a conversation's header) are
-- read by `engine_session_id`, which had no index: each read went through every notification of the
-- coworkers involved, up to 5,000 blocks and 22 ms on a copy of production, under 1.5 ms with it.
-- Alone in its migration: building it holds the writes to `notifications` for about a second.
create index if not exists notifications_engine_session_idx on public.notifications (engine_session_id);
