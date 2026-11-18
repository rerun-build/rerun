-- The LinkedIn Pro and WhatsApp Pro usage skills stop naming tools and scopes: the description of
-- <server>_list_tools lists the scopes, and each tool's description says what to check or read before
-- it. A tool added to or removed from an app no longer calls for a new skill text. A coworker gets
-- it when its services are next compiled.
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
             '- Daily limits protect the account. When a tool says a limit is reached, stop that action for the day and tell the user.' || E'\n' ||
             '- For bulk lead lists or enrichment, use the paid data tools, not this account.' || E'\n' ||
             '- Anything public or hard to undo (a post, an application, a profile edit, a deletion) only when the user asked for it or approved its exact content.'
         ))
       ),
       updated_at = now()
 where slug = 'linkedin-pro';

update public.services
   set manifest = manifest || jsonb_build_object(
         'skills', jsonb_build_array(jsonb_build_object(
           'name', 'whatsapp-pro-usage', 'description', 'How to write on WhatsApp as the user without getting the number banned',
           'body', '# WhatsApp Pro' || E'\n\n' ||
             'You act from the user''s own WhatsApp number. Everything you send carries their name, and WhatsApp bans a number that messages strangers.' || E'\n\n' ||
             '- Only the everyday tools are loaded. The rest is in whatsapp_pro_list_tools, by scope: its description lists the scopes and what each covers. Read the scope a task needs once, then run its tools with whatsapp_pro_run_tool.' || E'\n' ||
             '- Do what a tool''s description asks before using it: the check or the read it names.' || E'\n' ||
             '- Write only to people who expect to hear from the user: someone who wrote first, a customer, a contact the user named. Never send cold messages or the same text to a list.' || E'\n' ||
             '- Never send the same message twice, never follow up more than once without an answer. Keep messages short, the way the user would type them on a phone.' || E'\n' ||
             '- Numbers go in international format, e.g. +33612345678.' || E'\n' ||
             '- Bring into a group only people who know the user. Anything hard to undo (a deletion, leaving a group) only when the user asked for it.' || E'\n' ||
             '- Daily limits protect the number. When a tool says a limit is reached, stop writing for the day and tell the user.' || E'\n' ||
             '- In a group, answer only when the message is meant for the user.'
         ))
       ),
       updated_at = now()
 where slug = 'whatsapp-pro';
