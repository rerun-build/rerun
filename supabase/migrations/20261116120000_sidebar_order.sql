-- The order of the Boxes, and of the coworkers inside each, in the Simple view's list, shared by the
-- whole workspace. Null until someone arranges it: the list then falls back to when each was made.
-- Writing it follows the update rules already there: only who manages a Box reorders it or its
-- coworkers.
alter table public.spaces add column if not exists sidebar_order double precision;
alter table public.agents add column if not exists sidebar_order double precision;

-- `spaces` is granted column by column (20260812121424_column_level_grants).
grant select (sidebar_order), update (sidebar_order) on public.spaces to authenticated;
