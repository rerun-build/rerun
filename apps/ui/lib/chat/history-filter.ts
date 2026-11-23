import { sessionSourceSchema, type SessionSource } from '@rerun/contracts'
import { z } from 'zod'

export const sessionHistoryFilterSchema = z.enum(['all', 'chats', 'automations'])
export type SessionHistoryFilter = z.infer<typeof sessionHistoryFilterSchema>

const AUTOMATED_SOURCES: readonly SessionSource[] = ['schedule', 'trigger']

export const isAutomatedSource = (source: SessionSource) => AUTOMATED_SOURCES.includes(source)

// The sources a filter keeps, or undefined when it keeps them all.
export function sourcesOf(filter: SessionHistoryFilter): SessionSource[] | undefined {
    if (filter === 'automations') return [...AUTOMATED_SOURCES]
    if (filter === 'chats') return sessionSourceSchema.options.filter(source => !isAutomatedSource(source))
    return undefined
}
