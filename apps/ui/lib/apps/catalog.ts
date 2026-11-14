import { WAKE_EVENT_LABELS as LINKEDIN_WAKE_EVENT_LABELS } from './linkedin/wake-events'
import { WAKE_EVENT_LABELS as WHATSAPP_WAKE_EVENT_LABELS } from './whatsapp/wake-events'
import type { AppSlug } from './types'

export type AppInfo = {
    slug: AppSlug
    name: string
    providerLabel: string
    serviceSlug: string
    brandSlug: string
    wakeEventLabels: Record<string, string>
}

export const APP_INFO: Record<AppSlug, AppInfo> = {
    linkedin: { slug: 'linkedin', name: 'LinkedIn Pro', providerLabel: 'LinkedIn', serviceSlug: 'linkedin-pro', brandSlug: 'linkedin', wakeEventLabels: LINKEDIN_WAKE_EVENT_LABELS },
    whatsapp: { slug: 'whatsapp', name: 'WhatsApp Pro', providerLabel: 'WhatsApp', serviceSlug: 'whatsapp-pro', brandSlug: 'whatsapp', wakeEventLabels: WHATSAPP_WAKE_EVENT_LABELS },
}

export function appInfo(slug: AppSlug): AppInfo {
    return APP_INFO[slug]
}

export function isWakeEventOf(slug: AppSlug, value: string): boolean {
    return Object.hasOwn(APP_INFO[slug].wakeEventLabels, value)
}
