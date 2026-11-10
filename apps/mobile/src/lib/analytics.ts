import type { AnalyticsEventMap, EventName } from '@rerun/analytics'
import PostHog from 'posthog-react-native'

import { environment } from '@/config/environment'
import { clientPlatform } from '@/lib/client-platform'
import { POSTHOG_TOKEN } from '@rerun/cloud-mobile/environments'

// The client refuses an empty key; a build without a project gets this one, and is disabled.
const UNSET_TOKEN = 'phc_unset'

// A production build reports; staging and development runs stay out of the product numbers unless
// EXPO_PUBLIC_POSTHOG=1 asks for it, to check an event by hand.
const enabled = Boolean(POSTHOG_TOKEN) && (environment.name === 'production' || process.env.EXPO_PUBLIC_POSTHOG === '1')

const SUPER_PROPERTIES = { platform: clientPlatform, app_environment: environment.name }

// A JS error the app does not catch is fatal on iOS, and the crash report Apple keeps holds only the
// native stack: the message reaches PostHog this way.
export const posthog = new PostHog(POSTHOG_TOKEN || UNSET_TOKEN, {
    host: 'https://eu.i.posthog.com',
    disabled: !enabled,
    captureAppLifecycleEvents: true,
    errorTracking: { autocapture: { uncaughtExceptions: true, unhandledRejections: true } },
    // Masking is spelled out rather than left to the SDK defaults: a replay must never show a conversation,
    // and console logs may carry message text or tokens.
    enableSessionReplay: true,
    sessionReplayConfig: { maskAllTextInputs: true, maskAllImages: true, captureLog: false },
})
posthog.register(SUPER_PROPERTIES)

export function track<E extends EventName>(event: E, properties: AnalyticsEventMap[E]) {
    posthog.capture(event, properties as Record<string, string | number | boolean | null>)
}

// Same distinct id as the web, the account's email, a phone-born account's placeholder included.
export function identifyPerson(email: string) {
    posthog.identify(email, { $set: { email, is_internal: environment.name !== 'production' } })
}

export function registerWorkspace(workspaceId: number) {
    posthog.register({ workspace_id: workspaceId })
}

// The queue goes out first: reset empties it, and a sign-out right after a sign-in would lose the
// events of the sign-in.
export async function forgetPerson() {
    await posthog.flush()
    posthog.reset()
    posthog.register(SUPER_PROPERTIES)
}
