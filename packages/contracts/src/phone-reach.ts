import type { PhoneChannel } from './app-auth.js'

// Who a message goes out as: Bird Verify's shared identity for codes, or Rerun's own WhatsApp
// Business number for everything else. They are not refused in the same countries, and Meta holds
// back Rerun's number in more of them when the template it carries is a marketing one.
export type PhoneSender = 'verify' | 'rerun' | 'rerun_marketing'

const ALL_CHANNELS: readonly PhoneChannel[] = ['whatsapp', 'sms']

// No sender gets through: WhatsApp is blocked in China, and no SMS code ever arrived (PostHog, October 2026).
const UNREACHABLE: Partial<Record<string, readonly PhoneChannel[]>> = { CN: ['whatsapp', 'sms'] }

// Bird's shared WhatsApp sender carries no passcode there (https://bird.com/docs/guides/verify/countries,
// list as of October 1, 2026). Rerun's own number does deliver there.
const VERIFY_WHATSAPP_REFUSED: ReadonlySet<string> = new Set(['AE', 'BD', 'EG', 'ID', 'IN', 'IQ', 'KW', 'KZ', 'LK', 'MA', 'MY', 'NG', 'NP', 'OM', 'PK', 'SA', 'UA', 'ZA'])

// Bird takes the send, then reports every SMS code undelivered: Saudi Arabia, 0 of 42 delivered
// (PostHog, October to November 2026). Rerun's own WhatsApp number does deliver there.
const VERIFY_SMS_REFUSED: ReadonlySet<string> = new Set(['SA'])

// Meta keeps Rerun's own number out of these countries for every template, utility included
// (error 130497, 34 failures out of 34 to Brazil by November 2026).
const RERUN_WHATSAPP_REFUSED: ReadonlySet<string> = new Set(['BR'])

// Meta has paused marketing templates to US numbers (error 131049): 0 of 46 got through by
// November 2026, while utility ones still arrive. Canada and Puerto Rico share +1 and do receive.
const MARKETING_WHATSAPP_REFUSED: ReadonlySet<string> = new Set(['US'])

function refusedChannels(country: string, sender: PhoneSender): PhoneChannel[] {
    const refused = [...(UNREACHABLE[country] ?? [])]
    if (sender === 'verify' && VERIFY_WHATSAPP_REFUSED.has(country)) refused.push('whatsapp')
    if (sender === 'verify' && VERIFY_SMS_REFUSED.has(country)) refused.push('sms')
    if (sender !== 'verify' && RERUN_WHATSAPP_REFUSED.has(country)) refused.push('whatsapp')
    if (sender === 'rerun_marketing' && MARKETING_WHATSAPP_REFUSED.has(country)) refused.push('whatsapp')
    return refused
}

// `country` is an ISO 3166 alpha-2 code. A country the number does not name keeps every channel:
// nothing says it is out of reach.
export function reachableChannels(country: string | undefined, sender: PhoneSender): PhoneChannel[] {
    if (!country) return [...ALL_CHANNELS]
    const refused = refusedChannels(country, sender)
    return ALL_CHANNELS.filter(channel => !refused.includes(channel))
}
