-- With LinkedIn Pro, a coworker reads LinkedIn with the user's account, free, instead of buying the
-- same profiles, posts and comments as paid data. Paid data stays for what the account cannot read,
-- or once a daily limit of reading is reached. A coworker gets it when its services are next compiled.
update public.services
   set manifest = manifest || jsonb_build_object(
         'skills', jsonb_build_array(jsonb_build_object(
           'name', 'linkedin-pro-usage', 'description', 'How to act on LinkedIn as the user without getting the account restricted',
           'body', '# LinkedIn Pro' || E'\n\n' ||
             'You act from the user''s own LinkedIn account. Everything you send carries their name.' || E'\n\n' ||
             '- Only the everyday tools are loaded. The rest is in linkedin_pro_list_tools, by scope: its description lists the scopes and what each covers. Read the scope a task needs once, then run its tools with linkedin_pro_run_tool.' || E'\n' ||
             '- Do what a tool''s description asks before using it: the check, the read or the approval it names.' || E'\n' ||
             '- Read LinkedIn yourself with these tools. Never ask the user for screenshots of LinkedIn.' || E'\n' ||
             '- Never invite someone twice, never send the same message twice, never follow up more than once without an answer. Keep notes and messages short and personal, never a sales pitch.' || E'\n' ||
             '- A scope that needs a paid LinkedIn seat says so. When a tool says the seat is missing, tell the user instead of retrying.' || E'\n' ||
             '- Daily limits protect the account. When a tool says a limit is reached, do what it says and never retry that action today.' || E'\n' ||
             '- Read LinkedIn with this account first: profiles, posts, comments, reactions and people search cost no credit here. Offer the paid data tools only for what this account cannot read (work emails, phone numbers), or once a tool says a daily limit of reading is reached, and tell the user why.' || E'\n' ||
             '- Anything public or hard to undo (a post, an application, a profile edit, a deletion) only when the user asked for it or approved its exact content.'
         ))
       ),
       updated_at = now()
 where slug = 'linkedin-pro';
