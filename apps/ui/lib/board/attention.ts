import { ATTENTION_STATUSES as ATTENTION_STATUS_LIST } from '@moldwright/contracts'
import type { SessionEntry, SessionStatus } from '@/lib/board/types'

export { ATTENTION_STATUS_META as STATUS_META } from '@moldwright/ui/inbox'

export const ATTENTION_STATUSES = new Set<SessionStatus>(ATTENTION_STATUS_LIST)

export function attentionCountByAgent(sessions: SessionEntry[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const s of sessions) {
        if (!ATTENTION_STATUSES.has(s.status)) continue
        counts[s.agentId] = (counts[s.agentId] ?? 0) + 1
    }
    return counts
}
