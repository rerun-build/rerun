-- When the team of the organization was told the credit of this workspace had run out. Cleared by the
-- next allocation, so they are told once each time it happens.
alter table public.workspaces add column organization_credit_alerted_at timestamptz;
