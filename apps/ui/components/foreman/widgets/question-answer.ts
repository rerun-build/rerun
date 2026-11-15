import { asStringArray } from '@/lib/mcp/args'

export const UNANSWERED_REASONS = ['neither', 'typed', 'dismissed', 'abandoned'] as const
export type UnansweredReason = (typeof UNANSWERED_REASONS)[number]

export type QuestionAnswer = { answered: true; question: string; answers: string[] } | { answered: false; reason?: UnansweredReason }

export function readQuestionOutput(output: unknown): QuestionAnswer | null {
    if (!output || typeof output !== 'object') return null
    const value = output as Record<string, unknown>
    if (value.answered !== true) {
        const reason = UNANSWERED_REASONS.find(known => known === value.reason)
        return reason ? { answered: false, reason } : { answered: false }
    }
    return { answered: true, question: typeof value.question === 'string' ? value.question : '', answers: asStringArray(value.answers) }
}
