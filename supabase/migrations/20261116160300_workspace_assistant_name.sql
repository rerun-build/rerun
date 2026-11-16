-- The name a workspace gives its Chief of Staff. Null keeps "Chief of Staff".
alter table public.workspaces add column if not exists assistant_name text;
alter table public.workspaces drop constraint if exists workspaces_assistant_name_length;
alter table public.workspaces add constraint workspaces_assistant_name_length check (assistant_name is null or char_length(assistant_name) between 1 and 40);
