import { startAnalytics, startSessionReplay, stopAnalytics } from '@moldwright/analytics/client'

const NON_ANALYTICS_PREFIXES = ['/render/', '/og/', '/desktop-view']

export function isAnalyticsSurface(): boolean {
    if (typeof window === 'undefined') return false
    return !NON_ANALYTICS_PREFIXES.some(prefix => window.location.pathname.startsWith(prefix))
}

const POSTHOG_RUNTIME = {
    token: process.env.NODE_ENV === 'development' ? undefined : process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
}

export function startAppAnalytics() {
    startAnalytics({
        ...POSTHOG_RUNTIME,
        captureAttribution: true,
    })
}

export function startAppSessionReplay() {
    startSessionReplay(POSTHOG_RUNTIME)
}

export function stopAppAnalytics() {
    stopAnalytics(POSTHOG_RUNTIME)
}
