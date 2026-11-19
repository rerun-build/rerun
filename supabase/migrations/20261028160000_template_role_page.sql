-- The sections that turn a role template into a landing page: a run observed in the demo workspace,
-- what the same work costs per week on each way to pay, who hires the role, and the comparisons to
-- read next. Empty object means a plain template page.
alter table public.templates
  add column if not exists role_page jsonb not null default '{}'::jsonb;

comment on column public.templates.role_page is
  'Role landing sections (templateRolePageSchema in @moldwright/contracts). Authored in the admin editor only.';

-- SELECT on this table is granted column by column (20260812121424_column_level_grants.sql), so a
-- new column is invisible to the landing until it is named here.
grant select (role_page) on public.templates to anon;
grant select (role_page) on public.templates to authenticated;
