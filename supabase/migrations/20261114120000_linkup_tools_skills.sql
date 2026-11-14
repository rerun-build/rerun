-- LinkedIn Pro and WhatsApp Pro now hand coworkers every Linkup action on their account: the feed,
-- the network, groups, company pages, Sales Navigator and Recruiter on LinkedIn; chats and groups on
-- WhatsApp. Their catalogue rows say so, and their usage skills point to the new tools. A coworker
-- gets the new skill text when its services are next compiled.
update public.services
   set summary = 'Read the feed, search, invite, message, post and comment on LinkedIn as you, and wake up when someone replies.',
       manifest = manifest || jsonb_build_object(
         'summary', 'Read the feed, search, invite, message, post and comment on LinkedIn as you, and wake up when someone replies.',
         'description', 'Your coworker acts from a LinkedIn account connected to the workspace: it reads the feed, the network, groups and events, searches people, posts and companies, sends invitations and messages, follows the inbox, reacts, comments and posts, as the user or as a page they admin. With a Sales Navigator or Recruiter seat, it also searches leads and candidates, keeps lists, projects and jobs, and sends InMails. A reply or an accepted invitation can wake it up. Daily limits keep the account clear of LinkedIn restrictions. Billed by the slot on your plan.',
         'skills', jsonb_build_array(jsonb_build_object(
           'name', 'linkedin-pro-usage', 'description', 'How to act on LinkedIn as the user without getting the account restricted',
           'body', '# LinkedIn Pro' || E'\n\n' ||
             'You act from the user''s own LinkedIn account. Everything you send carries their name.' || E'\n\n' ||
             '- Read the feed, the network and the activity yourself: linkedin_pro_read_feed, linkedin_pro_list_connections, linkedin_pro_get_profile_posts. Never ask the user for screenshots of LinkedIn.' || E'\n' ||
             '- Before an invitation, check linkedin_pro_check_invitation so nobody is invited twice. Keep notes short and personal, never a sales pitch.' || E'\n' ||
             '- Before a message, read the conversation with linkedin_pro_get_conversation. Never send the same message twice, never follow up more than once without an answer.' || E'\n' ||
             '- The linkedin_pro_sales_nav_* tools need a Sales Navigator seat and the linkedin_pro_recruiter_* tools a Recruiter seat. When one says the seat is missing, tell the user instead of retrying.' || E'\n' ||
             '- Daily limits protect the account. When a tool says a limit is reached, stop that action for the day and tell the user.' || E'\n' ||
             '- For bulk lead lists or enrichment, use the paid data tools, not this account.' || E'\n' ||
             '- Publish a post, on the user''s feed or on a company page, only when the user asked for it or approved the text. Edit the profile or delete a message only when the user asked for it.'
         ))
       ),
       updated_at = now()
 where slug = 'linkedin-pro';

update public.services
   set summary = 'Read and answer WhatsApp conversations and groups from your own number, and wake up when someone writes.',
       manifest = manifest || jsonb_build_object(
         'summary', 'Read and answer WhatsApp conversations and groups from your own number, and wake up when someone writes.',
         'description', 'Your coworker acts from a WhatsApp number linked to the workspace, as a linked device: it reads a conversation, answers with text, files or voice notes, reacts, forwards, edits and deletes messages, keeps the chat list tidy, runs groups, posts a Status and checks which numbers are on WhatsApp. A new message can wake it up. Daily limits keep the number clear of a WhatsApp ban. Billed by the slot on your plan.',
         'skills', jsonb_build_array(jsonb_build_object(
           'name', 'whatsapp-pro-usage', 'description', 'How to write on WhatsApp as the user without getting the number banned',
           'body', '# WhatsApp Pro' || E'\n\n' ||
             'You act from the user''s own WhatsApp number. Everything you send carries their name, and WhatsApp bans a number that messages strangers.' || E'\n\n' ||
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
