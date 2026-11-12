import { getMe, login, type LinkupError, type LinkupLoginResult } from '@/lib/apps/linkup/client'
import type { ErrorCode, ErrorParams } from '@/lib/i18n/action-error'

// How a WhatsApp number is linked at Linkup, as a linked device of the phone (the way WhatsApp Web
// is), and what it is known by once it is.

// The number sets the country Linkup links it from. A pairing code replaces the QR code when the
// person is on the very phone they would have to scan with.
export function loginWhatsapp({ phoneNumber, pairingCode }: { phoneNumber: string; pairingCode: boolean }, accountName: string): Promise<LinkupLoginResult> {
    return login('whatsapp', { phone_number: phoneNumber, account_name: accountName, ...(pairingCode ? { params: { pairing_code: true } } : {}) })
}

type WhatsappMe = { phone_number: string; jid?: string; name?: string | null }

// The member id is the number itself: one free trial per number, one connection per number and per
// workspace.
export async function whatsappProfile(accountId: string): Promise<{ label: string; memberId: string }> {
    const me = await getMe<WhatsappMe>(accountId)
    const number = `+${me.phone_number.replace(/^\+/, '')}`
    return { label: me.name ? `${me.name} (${number})` : number, memberId: me.phone_number.replace(/^\+/, '') }
}

export const WHATSAPP_WEBHOOK_EVENTS = ['message_received'] as const

// Linkup keeps a WhatsApp account "connected" once the linked device is gone, and answers every
// send with this message, as INTERNAL_ERROR or CHANNEL_ERROR, without a disconnection webhook
// (ws 20770, 11/11/2026).
export function whatsappSessionClosed(err: LinkupError): boolean {
    return (err.code === 'INTERNAL_ERROR' || err.code === 'CHANNEL_ERROR') && /connection closed/i.test(err.message)
}

export function whatsappSignInRefusal(message: string): { code: ErrorCode; params?: ErrorParams } {
    if (/expired/i.test(message)) return { code: 'whatsappCodeExpired' }
    if (/refused|denied/i.test(message)) return { code: 'whatsappLinkRefused' }
    if (/phone|number/i.test(message)) return { code: 'whatsappNumberRefused', params: { message } }
    return { code: 'whatsappLinkRefusedBecause', params: { message } }
}
