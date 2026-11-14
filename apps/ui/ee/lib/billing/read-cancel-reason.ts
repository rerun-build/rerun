import { CANCEL_REASONS, CANCEL_REASON_GLOSS, type CancelReason } from './cancel-flow'

const DECISION_URL = 'https://openrouter.ai/api/alpha/decisions'
const DECISION_MODEL = process.env.RERUN_DECISION_MODEL ?? 'typesafe/jev-1.13'
const TIMEOUT_MS = 3000

const REJECTION_FLOOR = 0.75
const CATEGORY_FLOOR = 0.5

const GENUINE_INSTRUCTIONS =
    'A customer cancelling a software subscription was asked why they are leaving, and typed `answer`. Does it give a reason? It may be in any language, misspelled, blunt or only a few words long.'

const GENUINE_CRITERIA = {
    real_reason: 'it says something about why they are leaving, however short: "too expensive", "trop cher", "don\'t need it anymore", "bugs"',
    not_a_reason:
        'it says nothing about why: random letters or keyboard mashing, filler such as "no", "nothing", "idk", "n/a", "because", "cancel", "bye", a refusal to answer, or text unrelated to leaving',
}

const CATEGORY_INSTRUCTIONS = 'Which reason for cancelling does `answer` come under? Pick a named one whenever it plausibly fits; "other" is a last resort.'

export type CancelReasonReading = { genuine: boolean; reason: CancelReason }

type ChoiceAnswer = { choice?: unknown; confidence?: unknown }
type DecisionsResponse = { answers?: Record<string, ChoiceAnswer> }

function isCancelReason(value: unknown): value is CancelReason {
    return CANCEL_REASONS.some(reason => reason === value)
}

function confidenceOf(answer: ChoiceAnswer | undefined): number {
    return typeof answer?.confidence === 'number' ? answer.confidence : 0
}

export async function readCancelReason(text: string): Promise<CancelReasonReading | null> {
    const answer = text.trim()
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!answer || !apiKey) return null

    try {
        const response = await fetch(DECISION_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: DECISION_MODEL,
                state: { answer },
                questions: {
                    genuine: { type: 'choice', instructions: GENUINE_INSTRUCTIONS, criteria: GENUINE_CRITERIA },
                    category: { type: 'choice', instructions: CATEGORY_INSTRUCTIONS, criteria: CANCEL_REASON_GLOSS },
                },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!response.ok) return null

        const { genuine, category } = ((await response.json()) as DecisionsResponse).answers ?? {}
        if (genuine?.choice !== 'real_reason' && genuine?.choice !== 'not_a_reason') return null
        if (genuine.choice === 'not_a_reason' && confidenceOf(genuine) >= REJECTION_FLOOR) return { genuine: false, reason: 'other' }

        const reason = isCancelReason(category?.choice) && confidenceOf(category) >= CATEGORY_FLOOR ? category.choice : 'other'
        return { genuine: true, reason }
    } catch {
        return null
    }
}
