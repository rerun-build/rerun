import type { AuthMethod } from '@/lib/auth/auth-method'
import { isOAuthProvider, type OAuthProvider } from '@/lib/auth/oauth-providers'
import { LAST_SIGN_IN_COOKIE, LAST_SIGN_IN_MAX_AGE_SECONDS } from '@/lib/auth/last-sign-in-cookie'
import { useSyncExternalStore } from 'react'

export type LastSignInMethod = OAuthProvider | AuthMethod

export function isLastSignInMethod(value: unknown): value is LastSignInMethod {
    return value === 'email' || value === 'phone' || isOAuthProvider(value)
}

export function rememberSignInMethod(method: LastSignInMethod) {
    document.cookie = `${LAST_SIGN_IN_COOKIE}=${method}; path=/; max-age=${LAST_SIGN_IN_MAX_AGE_SECONDS}; samesite=lax`
}

function readLastSignInMethod(): LastSignInMethod | null {
    const value = document.cookie
        .split('; ')
        .find(entry => entry.startsWith(`${LAST_SIGN_IN_COOKIE}=`))
        ?.slice(LAST_SIGN_IN_COOKIE.length + 1)
    return isLastSignInMethod(value) ? value : null
}

const neverChanges = () => () => {}

export function useLastSignInMethod(): LastSignInMethod | null {
    return useSyncExternalStore(neverChanges, readLastSignInMethod, () => null)
}
