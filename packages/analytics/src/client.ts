import posthog from 'posthog-js'
import type { BeforeSendFn } from 'posthog-js'
import { SIGNUP_INTENT_COOKIE, type AnalyticsEventMap, type Attribution, type EventName } from './index'

type AnalyticsMode = 'off' | 'replay' | 'full'

let storageAllowed = false
let mode: AnalyticsMode = 'off'

const ATTRIBUTION_COOKIE = 'rr_attribution'

const FUNNEL_COOKIES = [
    ATTRIBUTION_COOKIE,
    SIGNUP_INTENT_COOKIE,
    'rr_verif_sent_at',
    'rr_signup_at',
    'rr_ab_person',
]

const HYDRATION_MISMATCH = /Minified React error #(418|423|425)\b/

function isPageTranslated(): boolean {
    if (typeof document === 'undefined') return false
    const root = document.documentElement.classList
    return root.contains('translated-ltr') || root.contains('translated-rtl') || document.querySelector('font') !== null
}

export const dropHydrationNoiseOnTranslatedPage: BeforeSendFn = event => {
    if (event?.event !== '$exception') return event
    const exceptions = (event.properties?.$exception_list ?? []) as { value?: string }[]
    const isHydrationMismatch = exceptions.some(exception => HYDRATION_MISMATCH.test(exception.value ?? ''))
    return isHydrationMismatch && isPageTranslated() ? null : event
}

const POSTHOG_BASE_CONFIG = {
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    defaults: '2026-01-30',
    capture_exceptions: true,
    cross_subdomain_cookie: true,
    persistence: 'localStorage+cookie',
    before_send: dropHydrationNoiseOnTranslatedPage,
} as const

const replaySnapshotsOnly: BeforeSendFn = event => (event?.event === '$snapshot' ? event : null)

const POSTHOG_REPLAY_ONLY_CONFIG = {
    ...POSTHOG_BASE_CONFIG,
    persistence: 'memory',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    capture_heatmaps: false,
    disable_surveys: true,
    before_send: replaySnapshotsOnly,
} as const

export function track<E extends EventName>(
    event: E,
    properties: AnalyticsEventMap[E],
    options?: { leavingPage?: boolean; set?: Record<string, unknown>; setOnce?: Record<string, unknown> },
) {
    if (!storageAllowed) return
    if (process.env.NODE_ENV === 'development') console.info(`[track] ${event}`, properties)
    posthog.capture(event, properties, {
        ...(options?.leavingPage && { transport: 'sendBeacon', send_instantly: true }),
        ...(options?.set && { $set: options.set }),
        ...(options?.setOnce && { $set_once: options.setOnce }),
    })
}

function writeCookie(name: string, value: string, maxAgeDays: number) {
    if (typeof document === 'undefined') return
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'path=/',
        `max-age=${maxAgeDays * 24 * 60 * 60}`,
        'SameSite=Lax',
    ]
    if (window.location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
}

export function setSharedCookie(name: string, value: string, maxAgeDays = 90) {
    if (!storageAllowed) return
    writeCookie(name, value, maxAgeDays)
}

export function deleteSharedCookie(name: string) {
    writeCookie(name, '', 0)
}

export function getCookie(name: string): string | undefined {
    if (typeof document === 'undefined') return undefined
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : undefined
}

function referrerDomain(): string | undefined {
    if (typeof document === 'undefined' || !document.referrer) return undefined
    try {
        const host = new URL(document.referrer).hostname
        if (host.endsWith('rerun.build')) return undefined
        return host || undefined
    } catch {
        return undefined
    }
}

let pendingAttribution: Attribution | undefined

export function rememberAttribution() {
    if (typeof window === 'undefined' || pendingAttribution) return

    const params = new URLSearchParams(window.location.search)
    const attribution: Attribution = {
        utm_source: params.get('utm_source') ?? undefined,
        utm_campaign: params.get('utm_campaign') ?? undefined,
        referrer_domain: referrerDomain(),
    }

    const hasSignal = attribution.utm_source || attribution.utm_campaign || attribution.referrer_domain
    if (!hasSignal) return

    pendingAttribution = attribution
}

export function persistAttribution() {
    if (!pendingAttribution) return
    if (getCookie(ATTRIBUTION_COOKIE)) return
    setSharedCookie(ATTRIBUTION_COOKIE, JSON.stringify(pendingAttribution))
}

type PosthogRuntime = { token?: string; debug?: boolean; lateExtensions?: boolean }

const LATE_EXTENSIONS_CONFIG = {
    disable_session_recording: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
} as const

const LATE_EXTENSIONS_FALLBACK_MS = 6000
const FIRST_GESTURES = ['pointerdown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const

function onFirstGestureOrLater(start: () => void) {
    let started = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = () => {
        if (started) return
        started = true
        clearTimeout(timer)
        for (const gesture of FIRST_GESTURES) window.removeEventListener(gesture, run)
        start()
    }

    for (const gesture of FIRST_GESTURES) window.addEventListener(gesture, run, { once: true, passive: true })

    const armFallback = () => {
        timer = setTimeout(run, LATE_EXTENSIONS_FALLBACK_MS)
    }
    if (document.readyState === 'complete') armFallback()
    else window.addEventListener('load', armFallback, { once: true })
}

export function startAnalytics({
    token,
    debug = false,
    captureAttribution = false,
    lateExtensions = false,
}: PosthogRuntime & { captureAttribution?: boolean }) {
    storageAllowed = true
    if (captureAttribution) persistAttribution()

    if (!token || mode === 'full') return

    if (mode === 'replay') {
        location.reload()
        return
    }

    mode = 'full'
    if (!lateExtensions) {
        posthog.init(token, { ...POSTHOG_BASE_CONFIG, debug })
        return
    }

    posthog.init(token, { ...POSTHOG_BASE_CONFIG, ...LATE_EXTENSIONS_CONFIG, debug })
    onFirstGestureOrLater(() => {
        posthog.config.capture_heatmaps = undefined
        posthog.config.capture_dead_clicks = undefined
        posthog.startSessionRecording()
    })
}

export function startSessionReplay({ token, debug = false, lateExtensions = false }: PosthogRuntime) {
    if (!token || mode !== 'off') return
    mode = 'replay'
    if (!lateExtensions) {
        posthog.init(token, { ...POSTHOG_REPLAY_ONLY_CONFIG, debug })
        return
    }

    posthog.init(token, { ...POSTHOG_REPLAY_ONLY_CONFIG, ...LATE_EXTENSIONS_CONFIG, debug })
    onFirstGestureOrLater(() => posthog.startSessionRecording())
}

export function identifyPerson(
    distinctId: string,
    properties?: Record<string, unknown>,
    propertiesSetOnce?: Record<string, unknown>,
) {
    if (!storageAllowed) return
    posthog.identify(distinctId, properties, propertiesSetOnce)
}

function deleteEverywhere(name: string) {
    const base = [`${name}=`, 'path=/', 'max-age=0']
    document.cookie = base.join('; ')
}

function clearPosthogStorage() {
    for (const cookie of document.cookie.split('; ')) {
        const name = cookie.split('=')[0]
        if (name.startsWith('ph_')) deleteEverywhere(name)
    }
    try {
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith('ph_') || key.startsWith('__ph_opt_in_out_')) localStorage.removeItem(key)
        }
    } catch {
    }
}

export function stopAnalytics(replay?: PosthogRuntime) {
    if (typeof window === 'undefined') return
    storageAllowed = false
    for (const name of FUNNEL_COOKIES) deleteEverywhere(name)
    clearPosthogStorage()

    if (mode === 'full') {
        posthog.set_config({ disable_persistence: true })
        location.reload()
        return
    }
    if (replay) startSessionReplay(replay)
}

export function readAttribution(): Attribution {
    const raw = getCookie(ATTRIBUTION_COOKIE)
    if (raw) {
        try {
            return JSON.parse(raw) as Attribution
        } catch {
        }
    }
    return {
        utm_source: (posthog.get_property('$initial_utm_source') as string | undefined) ?? undefined,
        utm_campaign: (posthog.get_property('$initial_utm_campaign') as string | undefined) ?? undefined,
        referrer_domain:
            (posthog.get_property('$initial_referring_domain') as string | undefined) ?? undefined,
    }
}
