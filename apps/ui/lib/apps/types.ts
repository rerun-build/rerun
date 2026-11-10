import type { AddonKey } from '@rerun/contracts'

// Paid apps follow the workspace the way a Shopify app follows its store: frozen while the box is
// archived, uninstalled once the box is gone for good.
export type AppStatus = 'active' | 'frozen' | 'uninstalled'

export type AppConnectionStatus = 'connecting' | 'connected' | 'needs_reconnect' | 'paused' | 'deleted'

export const APP_SLUGS = ['linkedin', 'whatsapp'] as const

export type AppSlug = (typeof APP_SLUGS)[number]

export const APP_ADDON_KEYS: Record<AppSlug, AddonKey> = { linkedin: 'linkedin_slot', whatsapp: 'whatsapp_slot' }

export function isAppSlug(value: string | null | undefined): value is AppSlug {
    return !!value && (APP_SLUGS as readonly string[]).includes(value)
}

// Every connection still bound to the workspace takes a slot, the ones waiting for a reconnect or
// paused included: the slot is what they come back into.
export const SLOT_HOLDING_STATUSES: readonly AppConnectionStatus[] = ['connecting', 'connected', 'needs_reconnect', 'paused']

export const WORKSPACE_APP_COLUMNS = ['workspace_id', 'app_slug', 'status', 'slots', 'trial_ends_at', 'trial_reminder_sent_at', 'trial_settled_at', 'frozen_at'] as const

export const APP_CONNECTION_COLUMNS = [
    'id',
    'workspace_id',
    'app_slug',
    'provider_account_id',
    'provider_member_id',
    'label',
    'connected_by',
    'status',
    'paused_until',
    'pause_reason',
    'last_event_at',
    'created_at',
] as const
