-- Every page of the app asks for an account since 17/11/2026: nothing signs in anonymously any more,
-- and "Allow anonymous sign-ins" is off on staging and prod. The hook now refuses an anonymous user
-- too, so turning the switch back on by mistake mints nobody. Everything else is unchanged from
-- 20261015130000_before_user_created_refuses_email_signup.
--
-- To ship only once the switch is off in production: before it, a browser still running the previous
-- app would be refused the session it asks for on its first page.
create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    candidate text;
begin
    if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false) or event -> 'user' -> 'app_metadata' ->> 'provider' = 'anonymous' then
        return jsonb_build_object(
            'error',
            jsonb_build_object('http_code', 403, 'message', 'Sign in on rerun.build to use Rerun.')
        );
    end if;

    if event -> 'user' -> 'app_metadata' ->> 'provider' in ('email', 'phone') then
        return jsonb_build_object(
            'error',
            jsonb_build_object('http_code', 403, 'message', 'Sign up on rerun.build with the code sent to your email, or with Google.')
        );
    end if;

    -- The user sits under `user`; an email at the root is still read, as in the first version of
    -- this hook: a wrong guess at the shape would cut every signup, not only the unwanted ones.
    candidate := coalesce(event -> 'user' ->> 'email', event ->> 'email', '');
    if public.email_domain_is_blocked(candidate) then
        return jsonb_build_object(
            'error',
            jsonb_build_object('http_code', 400, 'message', 'This email domain is not accepted. Use another address.')
        );
    end if;

    return '{}'::jsonb;
end;
$$;

grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.before_user_created(jsonb) from public, anon, authenticated;
