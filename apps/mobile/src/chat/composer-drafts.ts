import { useSyncExternalStore } from 'react'

// What is typed in each conversation's composer, by conversation as the web keys its drafts. Held
// here rather than in the composer: a widget that answers in its place unmounts it, and the text
// must still be there when it comes back.
const drafts = new Map<string, string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function draftOf(key: string): string {
    return drafts.get(key) ?? ''
}

export function setDraft(key: string, text: string) {
    if (text) drafts.set(key, text)
    else drafts.delete(key)
    listeners.forEach(listener => listener())
}

/** Puts text back in a conversation's composer, unless something is already typed there. */
export function restoreDraft(key: string, text: string): boolean {
    if (draftOf(key).trim()) return false
    setDraft(key, text)
    return true
}

export function useDraft(key: string): string {
    return useSyncExternalStore(subscribe, () => draftOf(key))
}
