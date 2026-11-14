import type { PhoneChannel } from './app-auth.js'

export type PhoneSender = 'verify' | 'rerun' | 'rerun_marketing'

const ALL_CHANNELS: readonly PhoneChannel[] = ['whatsapp', 'sms']

const UNREACHABLE: Partial<Record<string, readonly PhoneChannel[]>> = { CN: ['whatsapp', 'sms'] }

const VERIFY_WHATSAPP_REFUSED: ReadonlySet<string> = new Set(['AE', 'BD', 'EG', 'ID', 'IN', 'IQ', 'KW', 'KZ', 'LK', 'MA', 'MY', 'NG', 'NP', 'OM', 'PK', 'SA', 'UA', 'ZA'])

const VERIFY_SMS_REFUSED: ReadonlySet<string> = new Set(['SA'])

const RERUN_WHATSAPP_REFUSED: ReadonlySet<string> = new Set(['BR'])

const MARKETING_WHATSAPP_REFUSED: ReadonlySet<string> = new Set(['US'])

function refusedChannels(country: string, sender: PhoneSender): PhoneChannel[] {
    const refused = [...(UNREACHABLE[country] ?? [])]
    if (sender === 'verify' && VERIFY_WHATSAPP_REFUSED.has(country)) refused.push('whatsapp')
    if (sender === 'verify' && VERIFY_SMS_REFUSED.has(country)) refused.push('sms')
    if (sender !== 'verify' && RERUN_WHATSAPP_REFUSED.has(country)) refused.push('whatsapp')
    if (sender === 'rerun_marketing' && MARKETING_WHATSAPP_REFUSED.has(country)) refused.push('whatsapp')
    return refused
}

export function reachableChannels(country: string | undefined, sender: PhoneSender): PhoneChannel[] {
    if (!country) return [...ALL_CHANNELS]
    const refused = refusedChannels(country, sender)
    return ALL_CHANNELS.filter(channel => !refused.includes(channel))
}
