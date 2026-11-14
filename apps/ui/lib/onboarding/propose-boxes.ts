import { generateText } from 'ai'

import { hasOpenRouterKey, openrouter } from '@/lib/ai/openrouter'
import { clampBoxNames } from '@/lib/onboarding/intake'

const TEAMS_MODEL = 'anthropic/claude-haiku-4.5'

const TIMEOUT_MS = 4000

const LIST_MARK = /^\s*(?:[-*•]|\d+[.)])\s*/

export async function proposeBoxNames(words: string): Promise<string[] | null> {
    const kind = words.trim()
    if (!kind || !hasOpenRouterKey()) return null

    try {
        const { text } = await generateText({
            model: openrouter(TEAMS_MODEL),
            prompt: `Someone is setting up their company and describes the kind of company it is as: ${JSON.stringify(kind)}. Name the 4 to 6 top level divisions such a company runs as separate teams, the most essential first, for example "Clients", "Content" or "Prototypes". Each is one to three plain words, at most 24 characters, in the same language as their description. Reply with one name per line and nothing else.`,
            abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        })
        return clampBoxNames(
            text.split('\n').map(line =>
                line
                    .replace(LIST_MARK, '')
                    .replace(/[*"`]/g, '')
                    .replace(/[,.;]$/, '')
            )
        )
    } catch {
        return null
    }
}
