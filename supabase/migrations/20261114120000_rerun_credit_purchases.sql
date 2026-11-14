-- Rerun credit bought once: each pack paid adds to `workspaces.rerun_topup_micros`, the credit no
-- renewal ever resets. A purchase is written here once per Stripe payment, so the webhook and the
-- browser coming back from the payment can both report it without granting it twice. `stripe_ref` is
-- the payment intent of a purchase, or the subscription item of a recurring pack converted to it.
-- Service-role only.

create table public.rerun_credit_purchases (
    id uuid primary key default gen_random_uuid(),
    workspace_id bigint not null references public.workspaces (id) on delete cascade,
    stripe_ref text not null unique,
    packs integer not null check (packs > 0),
    micros bigint not null check (micros > 0),
    refunded_micros bigint not null default 0 check (refunded_micros >= 0 and refunded_micros <= micros),
    created_at timestamptz not null default now()
);

create index rerun_credit_purchases_workspace_id_idx on public.rerun_credit_purchases (workspace_id);

alter table public.rerun_credit_purchases enable row level security;
-- RLS does not cover truncate, and Supabase's default privileges hand it to anon on every new table.
revoke all on table public.rerun_credit_purchases from anon, authenticated;
grant select, insert, update, delete on table public.rerun_credit_purchases to service_role;

-- True when this call granted the credit, false when the payment had already been.
create or replace function public.grant_rerun_credit_purchase(p_workspace_id bigint, p_stripe_ref text, p_packs integer, p_micros bigint)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
begin
    insert into rerun_credit_purchases (workspace_id, stripe_ref, packs, micros)
    values (p_workspace_id, p_stripe_ref, p_packs, p_micros)
    on conflict (stripe_ref) do nothing;
    if not found then
        return false;
    end if;
    update workspaces set rerun_topup_micros = rerun_topup_micros + p_micros where id = p_workspace_id;
    return true;
end;
$function$;

-- `p_refunded_micros` is everything refunded on the payment so far, as Stripe reports it on the
-- charge, so a replayed or a second partial refund only takes back what was not taken yet. The credit
-- already spent stays spent: the balance never goes below zero. Returns the micros taken back.
create or replace function public.revoke_rerun_credit_purchase(p_stripe_ref text, p_refunded_micros bigint)
returns bigint
language plpgsql
set search_path to 'public'
as $function$
declare
    purchase rerun_credit_purchases%rowtype;
    taken bigint;
begin
    select * into purchase from rerun_credit_purchases where stripe_ref = p_stripe_ref for update;
    if not found then
        return 0;
    end if;
    taken := least(p_refunded_micros, purchase.micros) - purchase.refunded_micros;
    if taken <= 0 then
        return 0;
    end if;
    update rerun_credit_purchases set refunded_micros = refunded_micros + taken where id = purchase.id;
    update workspaces set rerun_topup_micros = greatest(rerun_topup_micros - taken, 0) where id = purchase.workspace_id;
    return taken;
end;
$function$;

revoke execute on function public.grant_rerun_credit_purchase(bigint, text, integer, bigint) from public, anon, authenticated;
revoke execute on function public.revoke_rerun_credit_purchase(text, bigint) from public, anon, authenticated;
grant execute on function public.grant_rerun_credit_purchase(bigint, text, integer, bigint) to service_role;
grant execute on function public.revoke_rerun_credit_purchase(text, bigint) to service_role;
