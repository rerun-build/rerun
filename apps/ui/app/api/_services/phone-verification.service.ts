import 'server-only'
import type { Database } from '@/app/api/database.types'
import type { VerificationChannel } from '@/lib/phone/verification'
import { BIRD_RESEND_COOLDOWN_MS, type VerificationFailure } from '@/lib/sms/bird-verify'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export const MIN_RESEND_INTERVAL_MS = BIRD_RESEND_COOLDOWN_MS
export const MIN_SWITCH_INTERVAL_MS = 20_000
export const SEND_WINDOW_MS = 60 * 60_000
export const MAX_SENDS_PER_WINDOW = 5

type UserPhoneUpdate = Database['public']['Tables']['user_phones']['Update']

export type PhoneVerificationFailure = VerificationFailure | 'not_required' | 'taken' | 'too_soon' | 'too_many'
export type PhoneRefusal<Failure extends string> = { ok: false; error: Failure; retryAfterSeconds?: number }

const secondsUntil = (time: number, now: number) => Math.max(1, Math.ceil((time - now) / 1000))

export type SendLedger = { lastSentAt: string | null; lastChannel: VerificationChannel | null; sendCount: number; windowStartedAt: string | null }

export function sendStanding(ledger: SendLedger, channel: VerificationChannel, now: number) {
    const interval = ledger.lastChannel && ledger.lastChannel !== channel ? MIN_SWITCH_INTERVAL_MS : MIN_RESEND_INTERVAL_MS
    const nextSendAt = ledger.lastSentAt ? Date.parse(ledger.lastSentAt) + interval : 0
    const windowStartedAt = ledger.windowStartedAt ? Date.parse(ledger.windowStartedAt) : null
    const windowIsOpen = windowStartedAt !== null && now - windowStartedAt < SEND_WINDOW_MS
    const sentInWindow = windowIsOpen ? ledger.sendCount : 0

    if (now < nextSendAt) return { refusal: 'too_soon' as const, retryAfterSeconds: secondsUntil(nextSendAt, now), windowIsOpen, sentInWindow }
    if (sentInWindow >= MAX_SENDS_PER_WINDOW) {
        return { refusal: 'too_many' as const, retryAfterSeconds: secondsUntil((windowStartedAt ?? now) + SEND_WINDOW_MS, now), windowIsOpen, sentInWindow }
    }
    return { refusal: null, retryAfterSeconds: undefined, windowIsOpen, sentInWindow }
}

export async function skipPhoneVerification(userId: string, unverifiedPhone?: string): Promise<boolean> {
    const stamp = new Date().toISOString()
    const { error } = await createServiceRoleClient()
        .from('user_phones')
        .update<UserPhoneUpdate>({ skipped_at: stamp, ...(unverifiedPhone ? { phone: unverifiedPhone, unverifiable_at: stamp, contact_consent_at: stamp } : {}) })
        .eq('user_id', userId)
        .is('verified_at', null)
    if (error) console.error('[phone] skip failed', error)
    return !error
}
