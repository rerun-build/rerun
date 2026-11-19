-- The look a coworker was given: { eyes, mouth, color }, checked by coworkerLookSchema of
-- @rerun/contracts. Null for a coworker nobody dressed: its buddy keeps the look hashed from its id,
-- exactly as before this column.
alter table public.agents add column if not exists look jsonb;

alter table public.agents drop constraint if exists agents_look_is_object;
alter table public.agents add constraint agents_look_is_object check (look is null or jsonb_typeof(look) = 'object');
