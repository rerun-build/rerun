-- The scripted walk through the isogrid board on a template's public page: a list of steps, each
-- staging what one agent does with a caption under the board. An empty list means no story, and the
-- page falls back to the free-running board.
alter table public.templates
  add column story jsonb not null default '[]'::jsonb;

comment on column public.templates.story is
  'Template story steps (templateStoryStepSchema in @moldwright/contracts). Authored in the admin editor only.';

-- SELECT on this table is granted column by column (20260812121424_column_level_grants.sql), so a
-- new column is invisible to the landing until it is named here.
grant select (story) on public.templates to anon;
grant select (story) on public.templates to authenticated;
