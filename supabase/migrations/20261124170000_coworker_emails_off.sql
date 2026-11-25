-- Coworker emails start again off for everyone: each person turns them on. A stored `email: true` was
-- never a choice, every write of the preferences merges the defaults in. Rows without `version: 2` need
-- nothing, they are read with the default, now off.
update public.users
set email_notification_prefs = jsonb_set(email_notification_prefs, '{email}', 'false'::jsonb, false)
where email_notification_prefs @> '{"version": 2, "email": true}'::jsonb;
