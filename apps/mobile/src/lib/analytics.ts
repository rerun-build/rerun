import type { AnalyticsEventMap, EventName } from '@moldwright/analytics'
import PostHog from 'posthog-react-native'

import { environment } from '@/config/environment'
import { clientPlatform } from '@/lib/client-platform'
import { POSTHOG_TOKEN } from '@moldwright/cloud-mobile/environments'

const UNSET_TOKEN = 'phc_unset'

const enabled = Boolean(POSTHOG_TOKEN) && (environment.name === 'production' || process.env.EXPO_PUBLIC_POSTHOG === '1')

const SUPER_PROPERTIES = { platform: clientPlatform, app_environment: environment.name }

export const posthog = new PostHog(POSTHOG_TOKEN || UNSET_TOKEN, {
    host: 'https://eu.i.posthog.com',
    disabled: !enabled,
    captureAppLifecycleEvents: true,
    errorTracking: { autocapture: { uncaughtExceptions: true, unhandledRejections: true } },
    enableSessionReplay: true,
    sessionReplayConfig: { maskAllTextInputs: true, maskAllImages: true, captureLog: false },
})
posthog.register(SUPER_PROPERTIES)

export function track<E extends EventName>(event: E, properties: AnalyticsEventMap[E]) {
    posthog.capture(event, properties as Record<string, string | number | boolean | null>)
}

export function identifyPerson(email: string) {
    posthog.identify(email, { $set: { email, is_internal: environment.name !== 'production' } })
}

export function registerWorkspace(workspaceId: number) {
    posthog.register({ workspace_id: workspaceId })
}

export async function forgetPerson() {
    await posthog.flush()
    posthog.reset()
    posthog.register(SUPER_PROPERTIES)
}
