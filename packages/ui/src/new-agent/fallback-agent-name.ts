import { declaredAgentName } from './declared-agent-name'
import { AGENT_NAME_MAX } from './reading'

const FALLBACK_WORDS = 5
const ENDS_A_CLAUSE = /[,.;:!?]$/
const TRAILING_PUNCTUATION = /[\s,.;:!?—–-]+$/

export function fallbackAgentName(task: string): string {
    const declared = declaredAgentName(task)
    if (declared) return declared

    const words = task.trim().split(/\s+/).slice(0, FALLBACK_WORDS)
    const clauseEnd = words.findIndex(word => ENDS_A_CLAUSE.test(word))
    const kept = clauseEnd === -1 ? words : words.slice(0, clauseEnd + 1)
    const name = kept.join(' ').replace(TRAILING_PUNCTUATION, '')
    return (name || words.join(' ')).slice(0, AGENT_NAME_MAX).trimEnd()
}
