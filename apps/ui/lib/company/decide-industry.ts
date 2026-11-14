import { isTemplateCategory, type TemplateCategory } from '@rerun/contracts'

import { INDUSTRY_GLOSS } from './industry'

const DECISION_URL = 'https://openrouter.ai/api/alpha/decisions'
const DECISION_MODEL = process.env.RERUN_DECISION_MODEL ?? 'typesafe/jev-1.13'

const CONFIDENCE_FLOOR = 0.5

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
        if (!choice || !isTemplateCategory(choice)) return null

        const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0
        return confidence < CONFIDENCE_FLOOR ? { industry: 'other', confidence } : { industry: choice, confidence }
    } catch {
        return null
    }
}
