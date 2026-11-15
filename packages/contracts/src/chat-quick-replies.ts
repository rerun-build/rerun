import { z } from 'zod'

import { stripBridgePrefix } from './chat-tool-name.js'

export const QUICK_REPLIES_TOOL = 'suggest_replies'
export const QUICK_REPLIES_MAX = 3
export const QUICK_REPLY_MAX_LENGTH = 40

export const quickRepliesInputSchema = z.object({
    replies: z.array(z.string()).describe(`1 to ${QUICK_REPLIES_MAX} replies the user can send in one click, each under ${QUICK_REPLY_MAX_LENGTH} characters.`),
})

export type QuickRepliesResult = { ok: true; replies: string[] } | { ok: false; reason: string }

export function parseQuickReplies(input: unknown): QuickRepliesResult {
    const parsed = quickRepliesInputSchema.safeParse(input)
    if (!parsed.success) return { ok: false, reason: 'replies must be a list of strings.' }

    const seen = new Set<string>()
    const replies: string[] = []
    for (const raw of parsed.data.replies) {
        const reply = raw.trim()
        const key = reply.toLowerCase()
        if (!reply || seen.has(key)) continue
        seen.add(key)
        replies.push(reply)
    }

    if (replies.length === 0) return { ok: false, reason: 'no reply given.' }
    if (replies.length > QUICK_REPLIES_MAX) return { ok: false, reason: `${replies.length} replies given, ${QUICK_REPLIES_MAX} at most.` }
    const tooLong = replies.find(reply => reply.length > QUICK_REPLY_MAX_LENGTH)
    if (tooLong) return { ok: false, reason: `"${tooLong}" is longer than ${QUICK_REPLY_MAX_LENGTH} characters.` }
    return { ok: true, replies }
}

const AWAITS_VALUE_MARK = /\s*(?:…|\.{3}|:)$/
const ANNOUNCES_VALUE = /^(?:here(?:'s|’s| is| are)|voici|ci-joint)\s[^,;.!?]*$/i

export function quickReplyDraft(reply: string): string | null {
    const trimmed = reply.trim()
    if (!AWAITS_VALUE_MARK.test(trimmed) && !ANNOUNCES_VALUE.test(trimmed)) return null
    const lead = trimmed.replace(AWAITS_VALUE_MARK, '')
    return lead ? `${lead}: ` : null
}

const PROMISES_PASTE = /\b(?:i['’]ll|i will|i['’]m going to)\s+(?:\w+\s+)?(?:paste|upload)\b|\bje\s+(?:vous\s+|te\s+|t['’]\s*)?colle\b|\bje\s+vais\s+(?:vous\s+|te\s+|t['’]\s*)?coller\b/i
const PROMISES_SEND = /\b(?:i['’]ll|i will|i['’]m going to)\s+(?:\w+\s+)?(?:send|share|give|add|grant|provide|drop|copy)\b|\bje\s+(?:vous\s+|te\s+|t['’]\s*)?(?:envoie|partage|donne|ajoute|transmets)\b|\bje\s+vais\s+(?:vous\s+|te\s+|t['’]\s*)?(?:envoyer|partager|donner|ajouter|transmettre)\b/i
const VALUE_NOUN = /(?:^|[^\p{L}])(?:urls?|links?|liens?|ids?|access|accès|files?|fichiers?|clones?|repos?|repository|dépôts?|keys?|clés?|tokens?|paths?|chemins?|e-?mails?|address(?:es)?|adresses?|credentials|identifiants|passwords?)(?![\p{L}])/iu
const DONE_BY_USER = /(?:^|[^\p{L}])(?:myself|moi-même)(?![\p{L}])/iu

export function quickReplyPromisesValue(reply: string): boolean {
    if (DONE_BY_USER.test(reply)) return false
    return PROMISES_PASTE.test(reply) || (PROMISES_SEND.test(reply) && VALUE_NOUN.test(reply))
}

type QuickRepliesPart = { type: string; toolName?: string; state?: string; input?: unknown }

function isQuickRepliesPart(part: QuickRepliesPart): boolean {
    const name = part.toolName ?? (part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : '')
    return stripBridgePrefix(name) === QUICK_REPLIES_TOOL
}

export function quickRepliesOf(message: { role: string; parts: readonly unknown[] }): string[] {
    if (message.role !== 'assistant') return []
    for (let i = message.parts.length - 1; i >= 0; i--) {
        const part = message.parts[i] as QuickRepliesPart
        if (typeof part?.type !== 'string' || !isQuickRepliesPart(part) || part.state === 'input-streaming') continue
        const result = parseQuickReplies(part.input)
        if (result.ok) return result.replies.filter(reply => !quickReplyPromisesValue(reply))
    }
    return []
}
