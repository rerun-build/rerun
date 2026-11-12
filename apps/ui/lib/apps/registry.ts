import type { AddonKey } from '@rerun/contracts'
import type { ErrorCode, ErrorParams } from '@/lib/i18n/action-error'
import { APP_INFO, type AppInfo } from './catalog'
import { LINKEDIN_WEBHOOK_EVENTS, linkedinProfile, linkedinSignInRefusal } from './linkedin/connect'
import * as linkedinEvents from './linkedin/events'
import * as linkedinQuotas from './linkedin/quotas'
import { LINKEDIN_TOOLS } from './linkedin/tools'
import { deleteAccount, type LinkupError, type LinkupPlatform } from './linkup/client'
import { WHATSAPP_WEBHOOK_EVENTS, whatsappProfile, whatsappSessionClosed, whatsappSignInRefusal } from './whatsapp/connect'
import * as whatsappEvents from './whatsapp/events'
import * as whatsappQuotas from './whatsapp/quotas'
import { WHATSAPP_TOOLS } from './whatsapp/tools'
import type { AttachmentSummary } from './attachments'
import type { AttachmentRef } from './linkup/client'
import type { EnvelopeKind, LinkupEnvelope } from './linkup/envelope'
import type { AppTool } from './tools'
import { APP_ADDON_KEYS, type AppSlug } from './types'

// What the socle needs to know about one paid app on the server. Adding an app is one entry here,
// its row in catalog.ts, and its folder of tools, quotas and events. Methods rather than function
// properties: each app narrows its own actions and events, which a method signature accepts.
export type AppDefinition = AppInfo & {
    addonKey: AddonKey
    platform: LinkupPlatform
    webhookEvents: readonly string[]
    tools: AppTool[]
    quotaClaim(action: string, at: Date): { periods: string[]; maxes: number[] }
    quotaRefusal(action: string): string
    envelopeKind(envelope: LinkupEnvelope): EnvelopeKind
    wakePayload(event: string, envelope: LinkupEnvelope, accountLabel: string | null, attachments: AttachmentSummary[]): Record<string, unknown>
    // The ids a file of this envelope is downloaded with, besides its own.
    attachmentBase(envelope: LinkupEnvelope): AttachmentRef
    wakeTrigger: { name: string; description: string; prompt(events: string[]): string }
    // What the account is called in the app, and the id that tells one person from another across
    // reconnects: the free trial is claimed on it.
    profile(accountId: string): Promise<{ label: string; memberId: string }>
    // What the person reads when the provider turns the sign-in down.
    signInRefusal(message: string): { code: ErrorCode; params?: ErrorParams }
    // A provider failure that means the account is gone, which the provider does not say as such.
    sessionClosed?(err: LinkupError): boolean
    deleteProviderAccount: (accountId: string) => Promise<void>
}

const APPS: Record<AppSlug, AppDefinition> = {
    linkedin: {
        ...APP_INFO.linkedin,
        addonKey: APP_ADDON_KEYS.linkedin,
        platform: 'linkedin',
        webhookEvents: LINKEDIN_WEBHOOK_EVENTS,
        tools: LINKEDIN_TOOLS,
        quotaClaim: linkedinQuotas.quotaClaim,
        quotaRefusal: linkedinQuotas.quotaRefusal,
        envelopeKind: linkedinEvents.envelopeKind,
        wakePayload: linkedinEvents.wakePayload,
        attachmentBase: linkedinEvents.attachmentBase,
        wakeTrigger: { name: 'LinkedIn events', description: 'Created by LinkedIn Pro. Fired by Rerun when one of the chosen LinkedIn events happens.', prompt: linkedinEvents.wakeTriggerPrompt },
        profile: linkedinProfile,
        signInRefusal: linkedinSignInRefusal,
        deleteProviderAccount: deleteAccount,
    },
    whatsapp: {
        ...APP_INFO.whatsapp,
        addonKey: APP_ADDON_KEYS.whatsapp,
        platform: 'whatsapp',
        webhookEvents: WHATSAPP_WEBHOOK_EVENTS,
        tools: WHATSAPP_TOOLS,
        quotaClaim: whatsappQuotas.quotaClaim,
        quotaRefusal: whatsappQuotas.quotaRefusal,
        envelopeKind: whatsappEvents.envelopeKind,
        wakePayload: whatsappEvents.wakePayload,
        attachmentBase: whatsappEvents.attachmentBase,
        wakeTrigger: { name: 'WhatsApp messages', description: 'Created by WhatsApp Pro. Fired by Rerun when a message reaches the WhatsApp number.', prompt: whatsappEvents.wakeTriggerPrompt },
        profile: whatsappProfile,
        signInRefusal: whatsappSignInRefusal,
        sessionClosed: whatsappSessionClosed,
        deleteProviderAccount: deleteAccount,
    },
}

export function appDefinition(slug: AppSlug): AppDefinition {
    return APPS[slug]
}

export function linkupPlatforms(): string[] {
    return Object.values(APPS).map(app => app.platform)
}
