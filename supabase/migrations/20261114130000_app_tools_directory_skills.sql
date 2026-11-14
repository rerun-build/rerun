-- LinkedIn Pro and WhatsApp Pro load their everyday tools only: the rest is read from a directory,
-- one scope at a time (<server>_list_tools), and run by name (<server>_run_tool). Their usage skills
-- say so, and no longer name as loaded a tool that now sits in a scope. A coworker gets the new
-- skill text when its services are next compiled; until then the description of list_tools carries
-- the directory by itself.
update public.services
   set manifest = manifest || jsonb_build_object(
         'skills', jsonb_build_array(jsonb_build_object(
           'name', 'linkedin-pro-usage', 'description', 'How to act on LinkedIn as the user without getting the account restricted',
           'body', '# LinkedIn Pro' || E'\n\n' ||
             'You act from the user''s own LinkedIn account. Everything you send carries their name.' || E'\n\n' ||
             '- Only the everyday tools are loaded: profiles, people search, invitations, messages, reacting, commenting, posting. Everything else is in linkedin_pro_list_tools, by scope: the feed and posts, the network, company pages, groups and events, Sales Navigator, Recruiter. Read the scope a task needs once, then run its tools with linkedin_pro_run_tool.' || E'\n' ||
             '- Read the feed, the network and the activity yourself, from the posts, network and profiles scopes. Never ask the user for screenshots of LinkedIn.' || E'\n' ||
             '- Before an invitation, check linkedin_pro_check_invitation so nobody is invited twice. Keep notes short and personal, never a sales pitch.' || E'\n' ||
             '- Before a message, read the conversation with linkedin_pro_get_conversation. Never send the same message twice, never follow up more than once without an answer.' || E'\n' ||
             '- The sales_navigator scope needs a Sales Navigator seat and the recruiter scope a Recruiter seat. When a tool says the seat is missing, tell the user instead of retrying.' || E'\n' ||
             '- Daily limits protect the account. When a tool says a limit is reached, stop that action for the day and tell the user.' || E'\n' ||
             '- For bulk lead lists or enrichment, use the paid data tools, not this account.' || E'\n' ||
             '- Publish a post, on the user''s feed or on a company page, only when the user asked for it or approved the text. Edit the profile or delete a message only when the user asked for it.'
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
             '- Only the everyday tools are loaded: reading chats, sending a message, checking numbers, posting a Status. Everything else is in whatsapp_pro_list_tools, by scope: more on messages (forward, react, edit, delete), chats (archive, pin, mute) and groups. Read the scope a task needs once, then run its tools with whatsapp_pro_run_tool.' || E'\n' ||
             '- Write only to people who expect to hear from the user: someone who wrote first, a customer, a contact the user named. Never send cold messages or the same text to a list.' || E'\n' ||
             '- Before every message, read the conversation with whatsapp_pro_get_conversation. Never send the same message twice, never follow up more than once without an answer.' || E'\n' ||
             '- Numbers go in international format, e.g. +33612345678. Use whatsapp_pro_check_numbers when you are not sure a number is on WhatsApp.' || E'\n' ||
             '- Keep messages short, the way the user would type them on a phone. Attach files by public URL.' || E'\n' ||
             '- Create a group or add people to one only with people who know the user. Delete a message or a chat, or leave a group, only when the user asked for it.' || E'\n' ||
             '- Daily limits protect the number. When a tool says a limit is reached, stop writing for the day and tell the user.' || E'\n' ||
             '- In a group, answer only when the message is meant for the user.'
         ))
       ),
       updated_at = now()
 where slug = 'whatsapp-pro';
