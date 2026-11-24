'use client'

import type { CoworkerDockNote } from '@rerun/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { dockEntryIdOf } from '@/lib/desktop-shell/coworker-dock'
import { freshNotes } from '@/lib/desktop-shell/coworker-dock-notes'

export type DockFilter = string | 'all'

// `note`: the note as it was when opened, so the detail and its receipt stay while the main window
// already lets it go.
export type DockPanel = { filter: DockFilter; note: CoworkerDockNote | null }

const EMPTY: CoworkerDockNote[] = []

// The inbox of the main window fills in over its first seconds: only what a coworker said since the
// dock opened pops up, never what already waited.
const CLOCK_SKEW_MS = 5_000

const entryOf = (note: CoworkerDockNote | undefined) => (note ? dockEntryIdOf(note.agentId) : undefined)

/** What opens from the rail: a bubble when a coworker says something new, the card on a coworker's notes or everyone's, a note opened in it. */
export function useDockNotes(published: CoworkerDockNote[] | undefined) {
    const notes = published ?? EMPTY
    const [bubbles, setBubbles] = useState<string[]>([])
    const [panel, setPanel] = useState<DockPanel | null>(null)
    const [openedAt] = useState(() => Date.now())
    const seen = useRef<Set<string>>(new Set())

    useEffect(() => {
        const fresh = freshNotes(notes, seen.current, openedAt - CLOCK_SKEW_MS)
        const byId = new Map(notes.map(note => [note.id, note]))
        // One bubble per coworker, the last thing it said.
        const latest = new Map<string, string>()
        for (const note of fresh) if (!latest.has(note.agentId)) latest.set(note.agentId, note.id)
        setBubbles(current => {
            const kept = current.filter(id => {
                const note = byId.get(id)
                return note !== undefined && !latest.has(note.agentId)
            })
            return latest.size === 0 && kept.length === current.length ? current : [...latest.values(), ...kept]
        })
    }, [notes, openedAt])

    const dismissBubble = useCallback((id: string) => setBubbles(current => current.filter(bubble => bubble !== id)), [])

    const openPanel = useCallback(
        (filter: DockFilter, note: CoworkerDockNote | null = null) => {
            setBubbles(current => {
                if (note) return current.filter(id => id !== note.id)
                if (filter === 'all') return []
                return current.filter(id => entryOf(notes.find(item => item.id === id)) !== filter)
            })
            setPanel({ filter, note })
        },
        [notes]
    )

    const togglePanel = useCallback((filter: DockFilter) => (panel?.filter === filter ? setPanel(null) : openPanel(filter)), [panel, openPanel])

    const closePanel = useCallback(() => setPanel(null), [])

    const showNote = useCallback((note: CoworkerDockNote | null) => setPanel(current => (current ? { ...current, note } : current)), [])

    const panelNotes = useMemo(() => (panel ? notes.filter(note => panel.filter === 'all' || entryOf(note) === panel.filter) : EMPTY), [notes, panel])
    const openNote = panel?.note ? (notes.find(note => note.id === panel.note?.id) ?? panel.note) : null
    const bubbleNotes = useMemo(() => bubbles.flatMap(id => notes.filter(note => note.id === id)), [bubbles, notes])

    return { notes, panel, panelNotes, openNote, bubbleNotes, dismissBubble, openPanel, togglePanel, closePanel, showNote }
}

export type DockNotes = ReturnType<typeof useDockNotes>
