import { z } from 'zod'

export type MessageFeedbackRating = 'up' | 'down'

export const MESSAGE_FEEDBACK_CATEGORIES = [
    { value: 'ui_bug', label: 'UI bug' },
    { value: 'did_not_follow', label: 'Did not follow my request' },
    { value: 'not_factual', label: 'Not factually correct' },
    { value: 'incomplete', label: 'Incomplete response' },
    { value: 'wrong_tool', label: 'Wrong tool or app used' },
    { value: 'tool_error', label: 'Tool or connection error' },
    { value: 'too_slow', label: 'Too slow' },
    { value: 'memory', label: 'Issue with memory' },
    { value: 'other', label: 'Other' },
] as const

export type MessageFeedbackCategory = (typeof MESSAGE_FEEDBACK_CATEGORIES)[number]['value']

export const MESSAGE_FEEDBACK_CATEGORY_VALUES = MESSAGE_FEEDBACK_CATEGORIES.map(c => c.value) as [MessageFeedbackCategory, ...MessageFeedbackCategory[]]

export function messageFeedbackCategoryLabel(value: string | null): string | null {
    if (!value) return null
    return MESSAGE_FEEDBACK_CATEGORIES.find(c => c.value === value)?.label ?? value
}

export const messageFeedbackScopeSchema = z.enum(['agent', 'foreman'])
export type MessageFeedbackScope = z.infer<typeof messageFeedbackScopeSchema>

export const messageFeedbackRateRequestSchema = z.object({
    scope: messageFeedbackScopeSchema.default('agent'),
    messageId: z.string().min(1).max(200),
    rating: z.enum(['up', 'down']),
    messageText: z.string().max(100_000),
})

export const messageFeedbackDetailsRequestSchema = z.object({
    category: z.enum(MESSAGE_FEEDBACK_CATEGORY_VALUES).nullable(),
    details: z.string().trim().max(5_000),
})

export const messageFeedbackEntrySchema = z.object({ id: z.string(), messageId: z.string(), rating: z.enum(['up', 'down']) })
export type MessageFeedbackEntry = z.infer<typeof messageFeedbackEntrySchema>
