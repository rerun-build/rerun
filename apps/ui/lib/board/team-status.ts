import type { SessionStatus } from '@/lib/board/types'

export type TeamMemberStatus = 'switched_off' | 'unconfigured' | 'offline' | 'working' | 'waiting_human' | 'error' | 'idle'

const WAITING_SESSION_STATUSES = new Set<SessionStatus>(['waiting_human', 'awaiting_question', 'awaiting_approval', 'awaiting_connector', 'awaiting_ack'])

export function isWaitingOnHuman(status: SessionStatus): boolean {
    return WAITING_SESSION_STATUSES.has(status)
}

type TeamMemberFacts = {
    switchedOff: boolean
    configured: boolean
    reachable: boolean
    runningCount: number
    waitingCount: number
    lastFinishedStatus: string | null
}

export function teamMemberStatus(facts: TeamMemberFacts): TeamMemberStatus {
    if (facts.switchedOff) return 'switched_off'
    if (!facts.configured) return 'unconfigured'
    if (!facts.reachable) return 'offline'
    if (facts.runningCount > 0) return 'working'
    if (facts.waitingCount > 0) return 'waiting_human'
    if (facts.lastFinishedStatus === 'error') return 'error'
    return 'idle'
}
