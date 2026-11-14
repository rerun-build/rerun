import { isPhoneCountry } from '@/lib/phone/normalize'
import type { VerificationChannel } from '@/lib/phone/verification'
import type { CountryCode } from 'libphonenumber-js/min'

type SentRequest = { phone: string; country: CountryCode; channel: VerificationChannel }
export type SentCode = { request: SentRequest; sentAt: number }

export const SENT_CODE_KEPT_MS = 10 * 60_000

const storageKey = (key: string) => `phone-code-sent:${key}`

function storage(): Storage | null {
    try {
        return globalThis.sessionStorage ?? null
    } catch {
        return null
    }
}

function isSentCode(value: unknown): value is SentCode {
    if (!value || typeof value !== 'object') return false
    const { request, sentAt } = value as Partial<SentCode>
    return (
        typeof sentAt === 'number' &&
        !!request &&
        typeof request.phone === 'string' &&
        typeof request.country === 'string' &&
        isPhoneCountry(request.country) &&
        (request.channel === 'sms' || request.channel === 'whatsapp')
    )
}

export function readSentCode(key: string, now = Date.now()): SentCode | null {
    try {
        const raw = storage()?.getItem(storageKey(key))
        if (!raw) return null
        const parsed: unknown = JSON.parse(raw)
        if (!isSentCode(parsed) || now - parsed.sentAt > SENT_CODE_KEPT_MS) return null
        return parsed
    } catch {
        return null
    }
}

export function writeSentCode(key: string, request: SentRequest, now = Date.now()): void {
    const sent: SentCode = { request: { phone: request.phone, country: request.country, channel: request.channel }, sentAt: now }
    try {
        storage()?.setItem(storageKey(key), JSON.stringify(sent))
    } catch {}
}

export function clearSentCode(key: string): void {
    try {
        storage()?.removeItem(storageKey(key))
    } catch {}
}
