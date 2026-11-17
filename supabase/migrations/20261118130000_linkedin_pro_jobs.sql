-- LinkedIn Pro reads LinkedIn job postings and applies to them with Easy Apply, from a new jobs scope of
-- its directory. Its catalogue row says so, and its usage skill names the scope and asks for the
-- user's approval before an application. A coworker gets the new skill text when its services are
-- next compiled.
update public.services
   set manifest = manifest || jsonb_build_object(
         'description', 'Your coworker acts from a LinkedIn account connected to the workspace: it reads the feed, the network, groups and events, searches people, posts, companies and job postings, sends invitations and messages, follows the inbox, reacts, comments and posts, as the user or as a page they admin, and applies to Easy Apply jobs the user approved. With a Sales Navigator or Recruiter seat, it also searches leads and candidates, keeps lists, projects and jobs, and sends InMails. A reply or an accepted invitation can wake it up. Daily limits keep the account clear of LinkedIn restrictions. Billed by the slot on your plan.',
         'skills', jsonb_build_array(jsonb_build_object(
           'name', 'linkedin-pro-usage', 'description', 'How to act on LinkedIn as the user without getting the account restricted',
           'body', '# LinkedIn Pro' || E'\n\n' ||
             'You act from the user''s own LinkedIn account. Everything you send carries their name.' || E'\n\n' ||
             '- Only the everyday tools are loaded: profiles, people search, invitations, messages, reacting, commenting, posting. Everything else is in linkedin_pro_list_tools, by scope: the feed and posts, the network, company pages, groups and events, jobs, Sales Navigator, Recruiter. Read the scope a task needs once, then run its tools with linkedin_pro_run_tool.' || E'\n' ||
             '- Read the feed, the network and the activity yourself, from the posts, network and profiles scopes. Never ask the user for screenshots of LinkedIn.' || E'\n' ||
             '- Before an invitation, check linkedin_pro_check_invitation so nobody is invited twice. Keep notes short and personal, never a sales pitch.' || E'\n' ||
             '- Before a message, read the conversation with linkedin_pro_get_conversation. Never send the same message twice, never follow up more than once without an answer.' || E'\n' ||
             '- The jobs scope searches job postings and gives who posted each one. Apply to a job only when the user approved that job and every answer: read its form first, never apply twice.' || E'\n' ||
             '- The sales_navigator scope needs a Sales Navigator seat and the recruiter scope a Recruiter seat. When a tool says the seat is missing, tell the user instead of retrying.' || E'\n' ||
             '- Daily limits protect the account. When a tool says a limit is reached, stop that action for the day and tell the user.' || E'\n' ||
             '- For bulk lead lists or enrichment, use the paid data tools, not this account.' || E'\n' ||
             '- Publish a post, on the user''s feed or on a company page, only when the user asked for it or approved the text. Edit the profile or delete a message only when the user asked for it.'
         ))
       ),
       updated_at = now()
 where slug = 'linkedin-pro';
