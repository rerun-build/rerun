import { COWORKER_DOCK_MAX_NOTES, type CoworkerDockNote } from '@rerun/contracts'

import type { InboxItem } from '@/hooks/useInboxItems'

// The inbox of the app as the dock shows it, in the same order. A `done` note stands for the last run
// it folds: that conversation is the one a reply from the dock goes to.
export function dockNotesOf(items: readonly InboxItem[]): CoworkerDockNote[] {
    return items.slice(0, COWORKER_DOCK_MAX_NOTES).map(item => ({
        id: item.id,
        agentId: item.agentId,
        status: item.status,
        title: item.title,
        text: item.message,
        updatedAt: item.updatedAt,
        sessionId: item.sessionIds ? (item.latestSessionId ?? null) : item.id,
        engineSessionId: item.engineSessionId,
        ...(item.count && item.count > 1 ? { count: item.count } : {}),
    }))
}

const versionOf = (note: CoworkerDockNote) => `${note.id}|${note.updatedAt ?? ''}`

/**
 * What a coworker said since `since` that the dock has not shown yet, newest first. `seen` only grows:
 * the main window publishes an empty inbox while it reloads, and what it held before must not pop up
 * again once it comes back.
 */
export function freshNotes(notes: readonly CoworkerDockNote[], seen: Set<string>, since: number): CoworkerDockNote[] {
    const fresh = notes.filter(note => !seen.has(versionOf(note)) && note.updatedAt !== null && Date.parse(note.updatedAt) >= since)
    for (const note of notes) seen.add(versionOf(note))
    return fresh.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/**
 * Where each bubble stands: level with its buddy, at least `pitch` below the one above, and the whole
 * pile moved up when it runs past `max`.
 */
export function stackBubbleTops(wanted: readonly { id: string; anchor: number }[], pitch: number, min: number, max: number): Map<string, number> {
    const sorted = [...wanted].sort((a, b) => a.anchor - b.anchor)
    const tops: number[] = []
    for (const [index, { anchor }] of sorted.entries()) tops.push(Math.max(anchor, min, index > 0 ? tops[index - 1] + pitch : -Infinity))
    const overflow = tops.length > 0 ? Math.min(tops[tops.length - 1] - max, tops[0] - min) : 0
    return new Map(sorted.map(({ id }, index) => [id, overflow > 0 ? tops[index] - overflow : tops[index]]))
}
