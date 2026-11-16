// Where to come back to after a sign-in that leaves the page: Google and Apple return to
// /auth/callback, and the link of the sign-in email opens /auth/confirm, often in another tab. Both
// only know a path through this cookie. Ten minutes, the time of the provider's own screens. The code
// typed in the email and phone forms follows `?next=` and never needs it.
export const AUTH_RETURN_COOKIE = 'rr_auth_return'
export const AUTH_RETURN_MAX_AGE_SECONDS = 600

export function writeAuthReturnCookie(path: string): void {
    document.cookie = `${AUTH_RETURN_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=${AUTH_RETURN_MAX_AGE_SECONDS}; samesite=lax`
}

export function clearAuthReturnCookie(): void {
    document.cookie = `${AUTH_RETURN_COOKIE}=; path=/; max-age=0; samesite=lax`
}

export function readAuthReturnCookie(raw: string | undefined): string | undefined {
    if (!raw) return undefined
    try {
        return decodeURIComponent(raw)
    } catch {
        return undefined
    }
}
