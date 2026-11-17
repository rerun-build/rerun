-- The lifetime plan splits in two. `lifetime_restricted` is what every lifetime code opens, with no
-- Claude subscription (AppSumo will not list a deal that signs buyers in with one); `lifetime` is the
-- same plan with nothing held back, opened by support. Every lifetime workspace so far was restricted.
--
-- Support used to give a lifetime customer the Claude subscription by moving the workspace to `base`
-- with no Stripe subscription behind it: those go back to a lifetime plan, the full one. That move
-- left the workspace `active`; a `base` workspace that is not active had its lifetime plan taken back
-- (a refunded code) and stays where it is. One statement, so the rows it moves to `lifetime` are not
-- caught again by the first branch.
update public.workspaces w
set plan = case when w.plan = 'lifetime' then 'lifetime_restricted' else 'lifetime' end
where w.plan = 'lifetime'
   or (
       w.plan = 'base'
       and w.stripe_subscription_id is null
       and w.subscription_status = 'active'
       and exists (
           select 1
           from public.invitation_redemptions r
           join public.invitation_codes c on c.id = r.code_id
           where r.workspace_id = w.id and c.plan = 'lifetime'
       )
   );
