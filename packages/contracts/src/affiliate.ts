import { analyticsAllowed, detectConsentStatus } from './consent.js'

export const AFFILIATE_PROGRAM_ID = 'cmtiy5ghr0015cy8j2yvr4zrf'

export const AFFILIATE_COOKIE_DURATION = '30'

export const AFFILIATE_BASE_PATH = '/r'

export const AFFILIATE_PROGRAM_URL = 'https://rerun.affonso.io'

export const AFFILIATE_REFERRAL_COOKIE = 'affonso_referral'

export const AFFILIATE_REFERRAL_METADATA_KEY = 'affonso_referral'

export const AFFILIATE_REFERRAL_PARAMS = ['affonso', 'atp', 'aff', 'via', 'ref', 'affonso_id'] as const

export function hasAffiliateReferral(search: string): boolean {
    const params = new URLSearchParams(search)
    return AFFILIATE_REFERRAL_PARAMS.some(name => params.has(name))
}

export const AFFILIATE_PIXEL_SRC = `${AFFILIATE_BASE_PATH}/pixel.js`

const AFFILIATE_API_ENDPOINTS = {
    track: 'https://api.affonso.io/v1/track',
    signups: 'https://api.affonso.io/v1/signups',
}

export type AffiliateApiEndpoint = keyof typeof AFFILIATE_API_ENDPOINTS

const CLIENT_IP_HEADERS = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip']

const FORWARDED_HEADERS = ['accept', 'accept-language', 'content-type', 'origin', 'referer', 'user-agent']

function clientIp(headers: Headers): string | null {
    for (const name of CLIENT_IP_HEADERS) {
        const value = headers.get(name)?.trim()
        if (value) return value
    }
    return headers.get('x-forwarded-for')?.split(',')[0].trim() || null
}

export async function proxyAffiliateApi(request: Request, endpoint: AffiliateApiEndpoint): Promise<Response> {
    const upstream = new URL(AFFILIATE_API_ENDPOINTS[endpoint])
    upstream.search = new URL(request.url).search

    const headers = new Headers()
    for (const name of FORWARDED_HEADERS) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
    }
    const ip = clientIp(request.headers)
    if (ip) {
        headers.set('x-real-ip', ip)
        headers.set('x-forwarded-for', ip)
    }

    let upstreamResponse: Response
    try {
        upstreamResponse = await fetch(upstream, {
            method: request.method,
            headers,
            body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
            cache: 'no-store',
        })
    } catch {
        return new Response(null, { status: 502 })
    }

    const responseHeaders = new Headers({ 'cache-control': 'no-store' })
    const contentType = upstreamResponse.headers.get('content-type')
    if (contentType) responseHeaders.set('content-type', contentType)
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders })
}

type AffiliateSignup = {
    email?: string
    externalUserId?: string
    name?: string
}

declare global {
    interface Window {
        Affonso?: { signup(signup: AffiliateSignup): void }
    }
}

const SIGNUP_RETRY_MS = 250
const SIGNUP_GIVE_UP_MS = 15_000

export function reportAffiliateSignup(signup: AffiliateSignup): void {
    if (typeof window === 'undefined') return
    if (!analyticsAllowed(detectConsentStatus())) return

    const giveUpAt = Date.now() + SIGNUP_GIVE_UP_MS
    const attempt = () => {
        if (window.Affonso) return window.Affonso.signup(signup)
        if (Date.now() < giveUpAt) window.setTimeout(attempt, SIGNUP_RETRY_MS)
    }
    attempt()
}
