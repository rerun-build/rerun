export const SESSION_HINT_COOKIE = 'rerun-session'

export const SESSION_HINT_VALUE = '1'

export const SESSION_HINT_MAX_AGE = 30 * 24 * 60 * 60

export const SESSION_HINT_ATTRIBUTE = 'data-session'

export const SESSION_HINT_SIGNED_IN = 'in'

export function parseSessionHintCookie(raw: string | undefined | null): boolean {
    return raw === SESSION_HINT_VALUE
}

export function readSessionHint(): boolean {
    if (typeof document === 'undefined') return false
    const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_HINT_COOKIE}=([^;]*)`))
    return parseSessionHintCookie(match ? decodeURIComponent(match[1]) : undefined)
}

export function clearSessionHintCookie() {
    const parts = [`${SESSION_HINT_COOKIE}=`, 'path=/', 'max-age=0', 'SameSite=Lax']
    if (location.hostname.endsWith('rerun.build')) parts.push('domain=.rerun.build')
    if (location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
}
