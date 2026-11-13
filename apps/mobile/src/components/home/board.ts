import { byRecency, coworkerLine, FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME, type AgentConversationsOverview, type AgentStatus, type BoardAgent } from '@rerun/contracts'

import type { StatusLine } from '@/components/ui/status'
import { translatorFor } from '@/i18n/translator'

export type HomeTranslator = ReturnType<typeof translatorFor<'mobileHome'>>

export type HomeCoworker = {
    id: string
    name: string
    handle: string | null
    description: string | null
    status: AgentStatus
    // Switched off, by hand or because the plan has no room left for it.
    paused: boolean
    spaceId: string
    latest: AgentConversationsOverview[number]['latest']
    pending: number
}

export type SectionKey = 'needs' | 'working' | 'coworkers'

export function toHomeCoworkers(agents: BoardAgent[], overview: AgentConversationsOverview): HomeCoworker[] {
    const byAgent = new Map(overview.map(entry => [entry.agentId, entry]))
    return agents.map(agent => {
        const entry = byAgent.get(agent.id)
        return { id: agent.id, name: agent.name, handle: agent.handle, description: agent.description, status: agent.status, paused: Boolean(agent.disabledAt), spaceId: agent.spaceId, latest: entry?.latest ?? null, pending: entry?.pending ?? 0 }
    })
}

export function sectionOf(coworker: HomeCoworker): SectionKey {
    if (coworker.paused) return 'coworkers'
    if (coworker.status === 'waiting_human' || coworker.status === 'error') return 'needs'
    if (coworker.status === 'working') return 'working'
    return 'coworkers'
}

// The avatar's mood: a paused coworker sleeps like one whose machine is off.
export const moodStatus = (coworker: HomeCoworker): AgentStatus => (coworker.paused ? 'offline' : coworker.status)

// The one line under a coworker's name, with the rules the web's list shares.
export function lineOf(coworker: HomeCoworker, t: HomeTranslator = translatorFor('mobileHome')): StatusLine {
    return coworkerLine(coworker, t)
}

export function minutesSince(iso: string | null | undefined, now = Date.now()): number | null {
    if (!iso) return null
    return Math.max(0, Math.floor((now - Date.parse(iso)) / 60000))
}

// Every coworker in one list, the most recently active first.
export function recentCoworkers(coworkers: HomeCoworker[]): HomeCoworker[] {
    return [...coworkers].sort(byRecency)
}

// The Foreman as a cell of the pinned grid: it can be pinned like a coworker, never listed among them.
export function foremanOnBoard(running: boolean): HomeCoworker {
    return { id: FOREMAN_AGENT_ID, name: FOREMAN_DISPLAY_NAME, handle: null, description: null, status: running ? 'working' : 'idle', paused: false, spaceId: '', latest: null, pending: 0 }
}

// The order after a pinned row was dragged from one place to another.
export function moveIn<T>(items: readonly T[], from: number, to: number): T[] {
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
    return next
}
