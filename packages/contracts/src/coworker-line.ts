import type { AgentStatus } from './board.js'

export type CoworkerLineTone = 'muted' | 'waiting' | 'destructive'
export type CoworkerLine = { text: string; tone: CoworkerLineTone }

// The last thing said in a conversation, as one line. `mine`: the person reading wrote it.
export type LastMessage = { text: string; mine: boolean }

// What the line under a coworker's name reads of it, on the phone's Home and in the web's list alike.
// `latest` is its most recent conversation, null for a coworker nobody has talked to yet. Its
// `lastMessage` is absent where the hub does not send it, and null in a conversation older than it.
export type CoworkerLineSubject = {
    status: AgentStatus
    // Switched off, by hand or because the plan has no room left for it.
    paused: boolean
    description: string | null
    latest: { title: string; updatedAt: string; lastMessage?: LastMessage | null } | null
}

// The keys the line is written with, in the phone's `mobileHome` pack and the web's `workspaceView`.
export type CoworkerLineKey = 'line.paused' | 'line.waiting' | 'line.error' | 'line.working' | 'line.workingOn' | 'line.asleep' | 'line.asleepAbout' | 'line.you'
export type CoworkerLineTranslator = (key: CoworkerLineKey, values?: { detail?: string; about?: string; message?: string }) => string

// The one line under a coworker's name: what it needs from you, what it is doing, or where it left off.
export function coworkerLine(coworker: CoworkerLineSubject, t: CoworkerLineTranslator): CoworkerLine {
    const title = coworker.latest?.title?.trim()
    const about = coworker.description?.trim() ?? ''
    if (coworker.paused) return { text: t('line.paused'), tone: 'muted' }
    if (coworker.status === 'waiting_human') return { text: title || t('line.waiting'), tone: 'waiting' }
    if (coworker.status === 'error') return { text: t('line.error'), tone: 'destructive' }
    if (coworker.status === 'working') {
        const detail = title || about
        return { text: detail ? t('line.workingOn', { detail }) : t('line.working'), tone: 'muted' }
    }
    if (coworker.status === 'offline') return { text: about ? t('line.asleepAbout', { about }) : t('line.asleep'), tone: 'muted' }
    const last = coworker.latest?.lastMessage
    if (last?.text) return { text: last.mine ? t('line.you', { message: last.text }) : last.text, tone: 'muted' }
    return { text: title || about, tone: 'muted' }
}

// The most recently active first, those never talked to last.
type Dated = { latest: { updatedAt: string } | null }

export function byRecency(a: Dated, b: Dated): number {
    return (b.latest?.updatedAt ?? '').localeCompare(a.latest?.updatedAt ?? '')
}

export type CoworkerSection<T> = { key: string; label: string; members: T[] }

// The coworkers by Box, in the order the Boxes were made, as on the web board, each Box's most recently
// active first. A Box without a coworker left is left out; an unnamed one reads `unnamedLabel`.
export function sectionsByBox<T extends Dated & { spaceId: string }>(coworkers: readonly T[], boxes: readonly { id: string; name: string | null }[], unnamedLabel: string): CoworkerSection<T>[] {
    const ordered = [...coworkers].sort(byRecency)
    return boxes.map(box => ({ key: box.id, label: box.name?.trim() || unnamedLabel, members: ordered.filter(coworker => coworker.spaceId === box.id) })).filter(section => section.members.length > 0)
}

// The coworkers pinned on this device, in the order they were arranged, and everyone else. A pin of a
// coworker deleted since is skipped. `extra` can be pinned like a coworker (the Chief of Staff), never
// listed among the others.
export function withPinned<T extends { id: string }>(coworkers: readonly T[], pinnedIds: readonly string[], extra?: T): { pinned: T[]; others: T[] } {
    const byId = new Map([...coworkers, ...(extra ? [extra] : [])].map(coworker => [coworker.id, coworker]))
    const pinned = pinnedIds.flatMap(id => byId.get(id) ?? [])
    const kept = new Set(pinned.map(coworker => coworker.id))
    return { pinned, others: coworkers.filter(coworker => !kept.has(coworker.id)) }
}
