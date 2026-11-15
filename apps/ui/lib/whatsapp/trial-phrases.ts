import { generateObject } from 'ai'
import { z } from 'zod'

import { hasOpenRouterKey, openrouter } from '@/lib/ai/openrouter'

const PHRASE_MODEL = process.env.RERUN_WHATSAPP_PHRASE_MODEL ?? 'anthropic/claude-haiku-4.5'
const TIMEOUT_MS = 20_000
const SOURCE_LIMIT = 6000
const PHRASE_LIMIT = 90

const phraseSchema = z.object({ phrase: z.string().nullable() })

const RULES = `You write one short phrase that slots into a WhatsApp message an AI coworker sends to the person it works for.
Rules:
- English, plain words, no quotes, no emoji, no markdown, no trailing period.
- Only facts present in the source. Never invent a number, a name or a result.
- At most 70 characters.
- Keep proper nouns (people, companies, cities, apps) capitalised.
- Return {"phrase": null} when the source does not clearly support a good phrase.`

async function phrase(task: string, source: string): Promise<string | null> {
    const text = source.trim()
    if (!text || !hasOpenRouterKey()) return null
    try {
        const { object } = await generateObject({
            model: openrouter(PHRASE_MODEL),
            schema: phraseSchema,
            system: `${RULES}\n\n${task}`,
            prompt: text.slice(0, SOURCE_LIMIT),
            temperature: 0,
            abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const clean = object.phrase?.replace(/[*_~`"]/g, '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim()
        return clean && clean.length <= PHRASE_LIMIT ? clean : null
    } catch (err) {
        console.error('[whatsapp] phrase failed', err instanceof Error ? err.message : err)
        return null
    }
}

export function firstResultPhrase(runOutput: string): Promise<string | null> {
    return phrase(
        `The phrase completes: "<phrase>, ready and waiting for you." It names what the coworker produced in the run below, as a noun phrase starting with a capital letter. Examples: "12 founders hiring in Paris", "Your competitor scan", "A draft reply to your 8 unread emails".`,
        runOutput,
    )
}

export function overnightResultPhrase(runOutput: string): Promise<string | null> {
    return phrase(
        `The phrase completes: "While you were sleeping I <phrase>." It says what the scheduled run below did, as a past-tense verb phrase starting with a lower-case verb. Examples: "found 4 new founders hiring in Paris", "sorted 23 emails and drafted 5 replies".`,
        runOutput,
    )
}

export function teaserPhrase(runOutput: string): Promise<string | null> {
    return phrase(
        `The phrase completes: "First one on the list: <phrase>". It is the first concrete item of the result below, specific enough to make someone curious. Example: "Head of Growth at Qonto, posted 3 hours ago". Null when the result holds no concrete item.`,
        runOutput,
    )
}

export function pendingActionPhrase(request: string): Promise<string | null> {
    return phrase(
        `The phrase completes: "Everything is ready to <phrase>. I'm only waiting for your OK." It is what the coworker is about to do, as a verb phrase starting with a lower-case verb, without "to". Example: "send a first message to 12 founders on LinkedIn". The source is the question or approval request the coworker is waiting on.`,
        request,
    )
}

export function weeklyIdeaPhrase(context: string): Promise<string | null> {
    return phrase(
        `The phrase completes: "What if, every week, you got <phrase>?" It is one weekly deliverable this coworker could produce for this company, picked from what the company told us it needs. The phrase itself begins with the word "a", "an" or "your", since the sentence before it has no article. Examples: "a digest of everything your 5 competitors post on LinkedIn", "a list of 10 companies hiring in your market".`,
        context,
    )
}
