export const CONSENT_COOKIE = 'rerun-consent'

export const CONSENT_COOKIE_MAX_AGE = 180 * 24 * 60 * 60

export const CONSENT_ATTRIBUTE = 'data-consent'

export const CONSENT_VERSION = 'v1'

export type ConsentDecision = 'granted' | 'denied'

export type ConsentStatus = ConsentDecision | 'pending' | 'exempt'

export const EEA_UK_TIME_ZONES = [
    'Africa/Ceuta',
    'America/Cayenne',
    'America/Guadeloupe',
    'America/Martinique',
    'Arctic/Longyearbyen',
    'Asia/Famagusta',
    'Asia/Nicosia',
    'Atlantic/Azores',
    'Atlantic/Canary',
    'Atlantic/Faroe',
    'Atlantic/Madeira',
    'Atlantic/Reykjavik',
    'Europe/Amsterdam',
    'Europe/Andorra',
    'Europe/Athens',
    'Europe/Berlin',
    'Europe/Bratislava',
    'Europe/Brussels',
    'Europe/Bucharest',
    'Europe/Budapest',
    'Europe/Busingen',
    'Europe/Copenhagen',
    'Europe/Dublin',
    'Europe/Gibraltar',
    'Europe/Guernsey',
    'Europe/Helsinki',
    'Europe/Isle_of_Man',
    'Europe/Jersey',
    'Europe/Lisbon',
    'Europe/Ljubljana',
    'Europe/London',
    'Europe/Luxembourg',
    'Europe/Madrid',
    'Europe/Malta',
    'Europe/Mariehamn',
    'Europe/Monaco',
    'Europe/Nicosia',
    'Europe/Oslo',
    'Europe/Paris',
    'Europe/Podgorica',
    'Europe/Prague',
    'Europe/Riga',
    'Europe/Rome',
    'Europe/San_Marino',
    'Europe/Sofia',
    'Europe/Stockholm',
    'Europe/Tallinn',
    'Europe/Vaduz',
    'Europe/Vatican',
    'Europe/Vienna',
    'Europe/Vilnius',
    'Europe/Warsaw',
    'Europe/Zagreb',
]

export function consentRequiredForTimeZone(timeZone?: string | null): boolean {
    return timeZone ? EEA_UK_TIME_ZONES.includes(timeZone) : true
}

export function parseConsentCookie(raw: string | undefined | null): ConsentDecision | undefined {
    if (!raw) return undefined
    const [version, decision] = raw.split(':')
    if (version !== CONSENT_VERSION) return undefined
    return decision === 'granted' || decision === 'denied' ? decision : undefined
}

export function readConsentCookie(): ConsentDecision | undefined {
    if (typeof document === 'undefined') return undefined
    const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))
    return parseConsentCookie(match ? decodeURIComponent(match[1]) : undefined)
}

export function writeConsentCookie(decision: ConsentDecision) {
    const parts = [
        `${CONSENT_COOKIE}=${CONSENT_VERSION}:${decision}:${Date.now()}`,
        'path=/',
        `max-age=${CONSENT_COOKIE_MAX_AGE}`,
        'SameSite=Lax',
    ]
    if (location.hostname.endsWith('rerun.build')) parts.push('domain=.rerun.build')
    if (location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
}

export function detectConsentStatus(): ConsentStatus {
    if (typeof document === 'undefined') return 'pending'
    const decision = readConsentCookie()
    if (decision) return decision
    try {
        return consentRequiredForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ? 'pending' : 'exempt'
    } catch {
        return 'pending'
    }
}

export function analyticsAllowed(status: ConsentStatus): boolean {
    return status !== 'denied'
}
