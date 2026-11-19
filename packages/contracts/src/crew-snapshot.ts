import { coworkerLine, type CoworkerLineSubject, type CoworkerLineTranslator } from './coworker-line.js'

// The coworkers that matter outside the app, the ones a widget, the Live Activity and the lock screen
// show: who waits on the person, who stopped on an error, who is at work. Built the same way on the
// phone (widgets) and on the hub (Live Activity pushes), so both read the same crew.

export type CrewState = 'waiting' | 'error' | 'working'

export type CrewMember = {
    id: string
    name: string
    state: CrewState
    // The line under its name, as the Home writes it.
    line: string
    // When its latest conversation last moved: how long it has been at work, or waiting.
    since: string | null
}

export type CrewSnapshot = { waiting: number; working: number; members: CrewMember[] }

export type CrewSubject = CoworkerLineSubject & { id: string; name: string }

// What fits the largest of the surfaces, the medium widget and the expanded island.
export const CREW_MEMBERS_MAX = 3

const ORDER: Record<CrewState, number> = { waiting: 0, error: 1, working: 2 }

function crewStateOf(coworker: CrewSubject): CrewState | null {
    if (coworker.paused) return null
    if (coworker.status === 'waiting_human') return 'waiting'
    if (coworker.status === 'error') return 'error'
    if (coworker.status === 'working') return 'working'
    return null
}

// Whoever waits first, then whoever stopped, then the longest at work.
export function crewSnapshotOf(coworkers: readonly CrewSubject[], t: CoworkerLineTranslator): CrewSnapshot {
    const members = coworkers
        .flatMap((coworker): CrewMember[] => {
            const state = crewStateOf(coworker)
            return state ? [{ id: coworker.id, name: coworker.name, state, line: coworkerLine(coworker, t).text, since: coworker.latest?.updatedAt ?? null }] : []
        })
        .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.since ?? '').localeCompare(b.since ?? ''))
    return {
        waiting: members.filter(member => member.state === 'waiting').length,
        working: members.filter(member => member.state === 'working').length,
        members: members.slice(0, CREW_MEMBERS_MAX),
    }
}
