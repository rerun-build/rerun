-- The daily limits of LinkedIn Pro and WhatsApp Pro become a recommended pace: a call past it still
-- goes through, and the tool adds a notice so the coworker tells the user the risk and the user
-- decides. count_app_usage counts a call without ever refusing it. claim_app_quota stays: the
-- wake-ups and the sign-in attempts still refuse past their limit, and the hub running during the
-- deploy still calls it.
create or replace function public.count_app_usage(p_scope text, p_action text, p_periods text[], p_amount integer default 1)
returns integer[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_period text;
    v_count integer;
    v_counts integer[] := '{}';
begin
    if p_amount <= 0 then
        return v_counts;
    end if;

    foreach v_period in array coalesce(p_periods, '{}') loop
        insert into public.app_usage_counters as counter (scope, action, period, count)
        values (p_scope, p_action, v_period, p_amount)
        on conflict (scope, action, period) do update set count = counter.count + excluded.count, updated_at = now()
        returning counter.count into v_count;
        v_counts := v_counts || v_count;
    end loop;
    return v_counts;
end;
$$;
revoke execute on function public.count_app_usage(text, text, text[], integer) from public, anon, authenticated;
grant execute on function public.count_app_usage(text, text, text[], integer) to service_role;

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
             '- Each tool''s description gives the pace recommended for the account. Plan within it. Past it, a tool still runs and adds a note: tell the user once, with the count and the risk of a LinkedIn restriction. Going on is the user''s call: never refuse what they ask because of a pace.' || E'\n' ||
             '- Read LinkedIn with this account first: profiles, posts, comments, reactions and people search cost no credit here. Offer the paid data tools only for what this account cannot read (work emails, phone numbers), or once a tool says the account is past its recommended pace of reading, as the safer way, and tell the user why.' || E'\n' ||
             '- Anything public or hard to undo (a post, an application, a profile edit, a deletion) only when the user asked for it or approved its exact content.'
         ))
       ),
       updated_at = now()
 where slug = 'linkedin-pro';

update public.services
   set manifest = jsonb_set(manifest, '{description}', to_jsonb(replace(manifest->>'description', 'Daily limits keep the account clear of LinkedIn restrictions.', 'It keeps to a recommended daily pace and tells you when going past it puts the account at risk of a LinkedIn restriction.'))),
       updated_at = now()
 where slug = 'linkedin-pro' and strpos(manifest->>'description', 'Daily limits keep the account clear of LinkedIn restrictions.') > 0;

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
             '- Each tool''s description gives the pace recommended for the number. Plan within it. Past it, a tool still runs and adds a note: tell the user once, with the count and the risk of a WhatsApp ban. Going on is the user''s call: never refuse what they ask because of a pace.' || E'\n' ||
             '- In a group, answer only when the message is meant for the user.'
         ))
       ),
       updated_at = now()
 where slug = 'whatsapp-pro';

update public.services
   set manifest = jsonb_set(manifest, '{description}', to_jsonb(replace(manifest->>'description', 'Daily limits keep the number clear of a WhatsApp ban.', 'It keeps to a recommended daily pace and tells you when going past it puts the number at risk of a WhatsApp ban.'))),
       updated_at = now()
 where slug = 'whatsapp-pro' and strpos(manifest->>'description', 'Daily limits keep the number clear of a WhatsApp ban.') > 0;
