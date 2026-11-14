import { WAKE_EVENT_LABELS as LINKEDIN_WAKE_EVENT_LABELS } from './linkedin/wake-events'
import { WAKE_EVENT_LABELS as WHATSAPP_WAKE_EVENT_LABELS } from './whatsapp/wake-events'
import type { AppSlug } from './types'

// What the browser knows of each paid app: names and the events a coworker can be woken by. The
// server side (Linkup calls, tools, quotas) is in registry.ts, which the browser never imports.
export type AppInfo = {
    slug: AppSlug
    name: string
    providerLabel: string
    // The service catalogue row coworkers install it from.
    serviceSlug: string
    // The MCP server its catalogue row declares, which the engine prefixes every tool name with.
    serverName: string
    // The plain catalogue row that lends its logo while the app's own row has none.
    brandSlug: string
    wakeEventLabels: Record<string, string>
}

export const APP_INFO: Record<AppSlug, AppInfo> = {
    linkedin: { slug: 'linkedin', name: 'LinkedIn Pro', providerLabel: 'LinkedIn', serviceSlug: 'linkedin-pro', serverName: 'linkedin_pro', brandSlug: 'linkedin', wakeEventLabels: LINKEDIN_WAKE_EVENT_LABELS },
    whatsapp: { slug: 'whatsapp', name: 'WhatsApp Pro', providerLabel: 'WhatsApp', serviceSlug: 'whatsapp-pro', serverName: 'whatsapp_pro', brandSlug: 'whatsapp', wakeEventLabels: WHATSAPP_WAKE_EVENT_LABELS },
}

// The two tools every paid app adds to its loaded ones: the directory of the rest, and the call that
// runs a tool read there.
export const APP_LIST_TOOLS = 'list_tools'
export const APP_RUN_TOOL = 'run_tool'

export function appInfo(slug: AppSlug): AppInfo {
    return APP_INFO[slug]
}

export function isWakeEventOf(slug: AppSlug, value: string): boolean {
    return Object.hasOwn(APP_INFO[slug].wakeEventLabels, value)
}
