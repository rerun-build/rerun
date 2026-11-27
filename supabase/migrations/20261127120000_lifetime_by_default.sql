-- Every lifetime code now opens the full lifetime plan, Claude subscription included. The restricted
-- plan stays, set by support by hand on a workspace that must not use one. Every lifetime workspace
-- restricted so far was restricted by default, so all of them get the full plan.
update public.workspaces
set plan = 'lifetime'
where plan = 'lifetime_restricted';
