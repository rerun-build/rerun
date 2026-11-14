import type { UIMessage } from 'ai'

import { parseKickoff, type KickoffIntent } from './kickoff-marker'

export function arrivingIntent(messages: UIMessage[]): KickoffIntent | null {
    const opening = messages.find(message => message.role === 'user')
    if (!opening) return null

    for (const part of opening.parts) {
        if (part.type !== 'text') continue
        const parsed = parseKickoff((part as { text: string }).text)
        if (parsed) return parsed.intent
    }
    return null
}
