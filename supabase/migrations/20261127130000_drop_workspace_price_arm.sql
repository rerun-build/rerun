-- The $29 / $49 price test ended on 27/11/2026: every workspace pays $29 and nothing reads the arm.
alter table public.workspaces drop column if exists price_arm;
