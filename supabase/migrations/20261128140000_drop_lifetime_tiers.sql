-- The AppSumo lifetime tiers are not sold (RER-455): no workspace ever got one, and the code that read
-- these columns is gone. Applied only once that code is live, the old one selects them in the session.
drop index if exists public.workspaces_lifetime_purchase_id_idx;

alter table public.workspaces
    drop column if exists api_access,
    drop column if exists lifetime_tier,
    drop column if exists lifetime_purchase_id;

alter table public.invitation_codes drop column if exists stackable;
