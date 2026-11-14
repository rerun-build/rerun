export const AUTH_RETURN_COOKIE = 'rr_auth_return'
export const AUTH_RETURN_MAX_AGE_SECONDS = 600

export function writeAuthReturnCookie(path: string): void {
    document.cookie = `${AUTH_RETURN_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=${AUTH_RETURN_MAX_AGE_SECONDS}; samesite=lax`
}

export function readAuthReturnCookie(raw: string | undefined): string | undefined {
    if (!raw) return undefined
    try {
        return decodeURIComponent(raw)
    } catch {
        return undefined
    }
}
