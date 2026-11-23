import { sessionSourceSchema, type SessionSource } from '@rerun/contracts'
import { z } from 'zod'

export const sessionHistoryFilterSchema = z.enum(['all', 'chats', 'automations'])
export type SessionHistoryFilter = z.infer<typeof sessionHistoryFilterSchema>

const AUTOMATED_SOURCES: readonly SessionSource[] = ['schedule', 'trigger']

export const isAutomatedSource = (source: SessionSource) => AUTOMATED_SOURCES.includes(source)

// A conversation another coworker opened (`call_agent`) is neither the team's chat nor a routine:
// only All lists it.
const isFromCoworker = (source: SessionSource) => source === 'agent'

// The sources a filter keeps, or undefined when it keeps them all.
export function sourcesOf(filter: SessionHistoryFilter): SessionSource[] | undefined {
    if (filter === 'automations') return [...AUTOMATED_SOURCES]
    if (filter === 'chats') return sessionSourceSchema.options.filter(source => !isAutomatedSource(source) && !isFromCoworker(source))
    return undefined
}
