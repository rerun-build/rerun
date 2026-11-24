import { WHITE_LABEL_ATTRIBUTE } from '@rerun/contracts'
import { startAnalytics, startSessionReplay, stopAnalytics } from '@rerun/analytics/client'

// Les routes `/render/` et `/og/` sont capturées par un navigateur headless : ni bannière dans les
// screenshots, ni faux pageviews. `/desktop-view` est l'écran d'un coworker dans l'app iOS, qui a
// son propre consentement. Un hôte en marque blanche n'est pas mesuré non plus : ses visiteurs sont
// ceux de l'organisation, et le bandeau leur citerait la politique de Rerun.
const NON_ANALYTICS_PREFIXES = ['/render/', '/og/', '/desktop-view']

export function isAnalyticsSurface(): boolean {
    if (typeof window === 'undefined') return false
    if (document.documentElement.hasAttribute(WHITE_LABEL_ATTRIBUTE)) return false
    return !NON_ANALYTICS_PREFIXES.some(prefix => window.location.pathname.startsWith(prefix))
}

const POSTHOG_RUNTIME = {
    // Pas de token en dev : l'analytics y est délibérément coupée, mais les cookies `rr_*`
    // continuent d'être écrits, ce qui rend le funnel testable en local.
    token: process.env.NODE_ENV === 'development' ? undefined : process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
}

export function startAppAnalytics() {
    startAnalytics({
        ...POSTHOG_RUNTIME,
        // Une campagne peut pointer directement sur l'app : sans ce flag, ses UTM restaient en
        // mémoire et n'atteignaient jamais account_created. First-write-wins, la landing garde
        // la priorité quand les deux tournent.
        captureAttribution: true,
    })
}

// Ce qui reste après un refus : le replay seul, sans cookie, sans localStorage et sans identité.
export function startAppSessionReplay() {
    startSessionReplay(POSTHOG_RUNTIME)
}

export function stopAppAnalytics() {
    stopAnalytics(POSTHOG_RUNTIME)
}
