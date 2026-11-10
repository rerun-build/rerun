import { isTemplateCategory, type TemplateCategory } from '@rerun/contracts'

import { INDUSTRY_GLOSS } from './industry'

// Which line of business, in under a second, from a domain name or from a sentence someone typed.
//
// The onboarding card draws the Boxes of a company as soon as it knows its industry, so what it
// needs is one value out of ten and nothing else. Scraping the home page and asking Gemini to
// describe the company costs three to seven seconds for that, and almost all of it is the scrape.
// This asks a decision model instead: it returns a typed choice with calibrated probabilities
// rather than prose, reads the address alone, and answers in 400 to 700ms.
//
// It does not replace `analyzeCompanyProfile`, which is the only thing that writes what the company
// sells and to whom, and that is what the foreman designs agents from. It runs in front of it.
//
// OpenRouter serves this through its own alpha endpoint rather than /chat/completions, so it is a
// hand-written fetch: `@ai-sdk/openai-compatible` has no idea this endpoint exists. Alpha also means
// it can change shape or go away, which is why nothing here ever throws. A null sends the caller
// back to the universal divisions and then to the full analysis.

const DECISION_URL = 'https://openrouter.ai/api/alpha/decisions'
const DECISION_MODEL = process.env.RERUN_DECISION_MODEL ?? 'typesafe/jev-1.13'

// Past this the board would be drawing the divisions of a business this person does not run. The
// model abstains honestly (an invented domain comes back as "other" around 0.5), so the floor is
// what turns that abstention into the universal list rather than into a wrong guess.
const CONFIDENCE_FLOOR = 0.5

// Long enough for the round trip measured at 400-750ms, short enough that a hung endpoint never
// holds the card: the answer only decorates the board, the user has already moved on.
const TIMEOUT_MS = 2000

const INSTRUCTIONS = 'Which line of business does the company behind this belong to? Pick a real one whenever the company plausibly belongs to it; "other" is a last resort, not a way to avoid choosing.'

export type IndustryDecision = { industry: TemplateCategory; confidence: number }

type DecisionsResponse = { answers?: Record<string, { choice?: unknown; confidence?: unknown }> }

export async function decideIndustry(input: string): Promise<IndustryDecision | null> {
    const trimmed = input.trim()
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!trimmed || !apiKey) return null

    try {
        const response = await fetch(DECISION_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: DECISION_MODEL,
                state: { input: trimmed },
                questions: { industry: { type: 'choice', instructions: INSTRUCTIONS, criteria: INDUSTRY_GLOSS } },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!response.ok) return null

        const answer = ((await response.json()) as DecisionsResponse).answers?.industry
        const choice = typeof answer?.choice === 'string' ? answer.choice : null
        // A choice outside the taxonomy is the endpoint having changed under us, not a company we
        // cannot place: there is nothing to salvage from it.
        if (!choice || !isTemplateCategory(choice)) return null

        const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0
        return confidence < CONFIDENCE_FLOOR ? { industry: 'other', confidence } : { industry: choice, confidence }
    } catch {
        return null
    }
}
