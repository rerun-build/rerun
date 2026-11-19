import { useState } from 'react'

// A conversation opens on its last messages; the earlier ones are drawn a stretch at a time, above,
// as the person scrolls up to them. Each stretch is a view of its own, so the one on screen keeps its
// place while another is added above it.
export const OPENING_MESSAGES = 30
export const EARLIER_STEP = 40

type Identified = { id: string }

// [from, to) in the whole thread. `key` stays the same as long as the stretch does.
export type TranscriptRange = { key: string; from: number; to: number }

// Each stretch starts at a message, named by its id: messages added at the end, or the hub's copy
// replacing the one kept on the phone, leave the stretches where they were.
export function transcriptRanges(messages: readonly Identified[], starts: readonly string[]): TranscriptRange[] | null {
    const indices = starts.map(id => messages.findIndex(message => message.id === id))
    if (indices.length === 0 || indices.some((index, k) => index < 0 || (k > 0 && index <= indices[k - 1]))) return null
    return indices.map((from, k) => ({ key: starts[k], from, to: indices[k + 1] ?? messages.length }))
}

export function openingStart(messages: readonly Identified[]): string {
    return messages[Math.max(0, messages.length - OPENING_MESSAGES)].id
}

export function useTranscriptWindow(messages: readonly Identified[]) {
    const [starts, setStarts] = useState<string[]>([])
    const ranges = messages.length > 0 ? transcriptRanges(messages, starts) : null
    // The first messages to arrive, or a copy where a stretch's first message is gone: the thread opens
    // again on its end.
    if (messages.length > 0 && !ranges) setStarts([openingStart(messages)])
    const shown = ranges ?? (messages.length > 0 ? [{ key: openingStart(messages), from: Math.max(0, messages.length - OPENING_MESSAGES), to: messages.length }] : [])
    const first = shown[0]?.from ?? 0
    const showEarlier = () => {
        if (first === 0) return
        const start = messages[Math.max(0, first - EARLIER_STEP)].id
        setStarts(current => (current[0] === start ? current : [start, ...current]))
    }
    return { earlier: shown.slice(0, -1), recent: shown.at(-1) ?? null, hasEarlier: first > 0, showEarlier }
}
