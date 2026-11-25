-- An organization sits above workspaces: it owns several of them, pays Rerun for them, and shows the
-- app under its own brand. Everything here is read and written by the service role alone: its team
-- goes through the console's actions, its clients never see it.
create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    -- What its clients call the product.
    name text not null check (char_length(btrim(name)) between 1 and 40 and name !~ '[{}<>#|[:cntrl:]]'),
    -- The label of its default address.
    slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
    status text not null default 'active' check (status in ('active', 'suspended')),
    -- How many workspaces it may hold, archived ones included. Set by hand when it is billed.
    max_workspaces integer not null default 3 check (max_workspaces between 0 and 1000),
    -- A square image with its own background, drawn at 512 px. Null until its team uploads one.
    icon_url text,
    color text check (color ~ '^#[0-9a-f]{6}$'),
    support_email text,
    -- Printed as the target of a link, so never another scheme.
    docs_url text check (docs_url ~ '^https://'),
    terms_url text check (terms_url ~ '^https://'),
    privacy_url text check (privacy_url ~ '^https://'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger organizations_updated_at before update on public.organizations for each row execute function public.handle_updated_at();

create table public.organization_members (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    -- An owner also manages the team and the organization's credit; an admin runs its workspaces.
    role text not null check (role in ('owner', 'admin')),
    created_at timestamptz not null default now(),
    primary key (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id);

-- An organization with workspaces is never deleted from under them.
alter table public.workspaces add column organization_id uuid references public.organizations(id) on delete restrict;
-- When the organization put this workspace away. Its access (`subscription_status`) is also cut while
-- the organization itself is suspended, and this is what tells the two apart once it resumes.
alter table public.workspaces add column organization_archived_at timestamptz;
create index workspaces_organization_idx on public.workspaces (organization_id) where organization_id is not null;

-- The organization's team inside one of its clients' workspaces: a full member for the database and
-- the session, invisible in every list the client reads (apps/ui/app/api/_auth/workspace-members.ts).
alter table public.workspace_members add column organization_staff boolean not null default false;

create index workspace_members_staff_idx on public.workspace_members (user_id) where organization_staff;

-- What an invited person becomes once in. An organization invites the first admin of a workspace.
alter table public.workspace_invitations add column role public.workspace_role not null default 'member';

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
revoke all on table public.organizations, public.organization_members from anon, authenticated;
grant all on table public.organizations, public.organization_members to service_role;

-- The "invite a teammate" step of a new workspace is its members' to take: an organization opening a
-- client's workspace, or inviting its first admin, does not tick it.
create or replace function public.getting_started_on_member()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
    if (select count(*) from public.workspace_members where workspace_id = new.workspace_id and not organization_staff) > 1 then
        perform public.mark_getting_started(new.workspace_id, 'invite');
    end if;
    return null;
end
$function$;

create or replace trigger getting_started_on_invitation
    after insert on public.workspace_invitations
    for each row when (new.role = 'member') execute function public.getting_started_on_invitation();
