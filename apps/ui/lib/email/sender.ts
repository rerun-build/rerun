// No 'server-only', see lib/email/client.ts.
import { isWhiteLabel, type Brand } from '@rerun/contracts'
import { REPLY_TO, TRANSACTIONAL_FROM } from './client'

const NAME_MAX_LENGTH = 64

// Goes inside the quotes of a From header: what ends the quoted name, opens an address or starts a
// new header line is taken out.
export function senderName(name: string): string {
    const safe = name
        .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
        .replace(/["\\<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return [...safe].slice(0, NAME_MAX_LENGTH).join('').trim()
}

function addressOf(from: string): string {
    return from.match(/<([^<>]+)>\s*$/)?.[1] ?? from
}

// An organization signs with its own name and is answered at its own address. Without one there is
// no reply-to at all: Rerun's mailbox is not theirs.
export function emailSender(brand: Brand, from: string = TRANSACTIONAL_FROM): { from: string; replyTo: string | undefined } {
    if (!isWhiteLabel(brand)) return { from, replyTo: REPLY_TO }
    const address = addressOf(from)
    const name = senderName(brand.name)
    return { from: name ? `"${name}" <${address}>` : address, replyTo: brand.supportEmail ?? undefined }
}
