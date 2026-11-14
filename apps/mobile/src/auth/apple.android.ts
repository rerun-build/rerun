import * as WebBrowser from 'expo-web-browser'

import { SignInError } from '@/auth/sign-in'
import { supabase } from '@/auth/supabase'

const FAILED = 'We could not sign you in with Apple. Try again.'

export const APPLE_REDIRECT = 'rerun://auth/callback'

export async function signInWithApple(): Promise<boolean> {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: APPLE_REDIRECT, skipBrowserRedirect: true } })
    if (error || !data.url) throw new SignInError(FAILED, 'apple')

    const result = await WebBrowser.openAuthSessionAsync(data.url, APPLE_REDIRECT)
    if (result.type !== 'success') return false

    const code = new URL(result.url).searchParams.get('code')
    if (!code) throw new SignInError(FAILED, 'apple')
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) throw new SignInError(FAILED, 'apple')
    return true
}
