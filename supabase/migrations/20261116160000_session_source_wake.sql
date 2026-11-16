-- A run of the Chief of Staff that nobody started: it woke up on its own. Alone in its file, since a
-- value added to an enum cannot be used in the transaction that adds it.
alter type public.session_source add value if not exists 'wake';
