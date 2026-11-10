'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { readBrainPageAction, saveBrainPageAction } from '@/app/api/_actions/brain.actions'
import type { BrainPageDetail } from '@/lib/engine/client'
import type { BrainPage, BrainPageType } from '@rerun/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

export type BrainDraft = { title: string; type: BrainPageType; content: string }

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict'

const DEBOUNCE_MS = 1000

// The last write of a page that was just left can still be in flight when it is opened again: read
// before it lands and the page comes back with a hash its own write already replaced.
const pendingSaves = new Map<string, Promise<void>>()

export const pendingBrainSave = (slug: string) => pendingSaves.get(slug) ?? Promise.resolve()

type UseBrainAutosaveOptions = {
    page: BrainPage
    onSaved: (detail: BrainPageDetail) => void
}

// A page saves itself a second after the last keystroke, against the version it was opened at. If
// an agent's change landed in between, the write is refused and the person picks a side; nothing
// is lost either way, the other version stays in the history.
export function useBrainAutosave({ page, onSaved }: UseBrainAutosaveOptions) {
    const [status, setStatus] = useState<AutosaveStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const errorText = useErrorText()
    const [conflictWith, setConflictWith] = useState<BrainPage | null>(null)

    const draft = useRef<BrainDraft>({ title: page.title, type: page.type, content: page.content })
    const baseHash = useRef<string | null>(page.hash)
    const sources = useRef(page.sources)
    const dirty = useRef(false)
    const conflicted = useRef(false)
    const failed = useRef(false)
    const inFlight = useRef<Promise<void> | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onSavedRef = useRef(onSaved)

    useEffect(() => {
        onSavedRef.current = onSaved
    })

    const write = useCallback(async () => {
        if (!dirty.current || conflicted.current) return
        if (!draft.current.title.trim()) return
        dirty.current = false
        failed.current = false
        setStatus('saving')
        const snapshot = draft.current
        const result = await saveBrainPageAction(page.slug, { ...snapshot, sources: sources.current, baseHash: baseHash.current })
        if (result.ok) {
            baseHash.current = result.detail.page.hash
            setError(null)
            setStatus(dirty.current ? 'pending' : 'saved')
            onSavedRef.current(result.detail)
            return
        }
        dirty.current = true
        if (result.conflict) {
            conflicted.current = true
            setStatus('conflict')
            const latest = await readBrainPageAction(page.slug)
            setConflictWith(latest?.page ?? null)
            return
        }
        failed.current = true
        setError(errorText(result))
        setStatus('error')
    }, [page.slug, errorText])

    const flushRef = useRef<() => Promise<void>>(async () => {})

    const schedule = useCallback(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void flushRef.current(), DEBOUNCE_MS)
    }, [])

    // One write at a time: the next one waits and starts from the hash the previous one returned.
    const flush = useCallback(async () => {
        if (timer.current) {
            clearTimeout(timer.current)
            timer.current = null
        }
        while (inFlight.current) await inFlight.current
        if (!dirty.current || conflicted.current) return
        const run = write().finally(() => {
            inFlight.current = null
        })
        inFlight.current = run
        await run
        if (dirty.current && !conflicted.current && !failed.current && draft.current.title.trim()) schedule()
    }, [write, schedule])

    useEffect(() => {
        flushRef.current = flush
    })

    const edit = useCallback(
        (patch: Partial<BrainDraft>) => {
            draft.current = { ...draft.current, ...patch }
            dirty.current = true
            if (!conflicted.current) {
                setStatus('pending')
                schedule()
            }
        },
        [schedule],
    )

    // Their version wins: the draft is dropped and the editor reloads from what the page says now.
    const loadTheirs = useCallback(async (): Promise<BrainPage | null> => {
        const latest = await readBrainPageAction(page.slug)
        if (!latest) return null
        draft.current = { title: latest.page.title, type: latest.page.type, content: latest.page.content }
        baseHash.current = latest.page.hash
        sources.current = latest.page.sources
        dirty.current = false
        conflicted.current = false
        setConflictWith(null)
        setStatus('idle')
        onSavedRef.current(latest)
        return latest.page
    }, [page.slug])

    // This draft wins, written on top of the version that refused it.
    const keepMine = useCallback(async () => {
        const latest = await readBrainPageAction(page.slug)
        baseHash.current = latest?.page.hash ?? null
        if (latest) sources.current = latest.page.sources
        conflicted.current = false
        setConflictWith(null)
        dirty.current = true
        await flush()
    }, [page.slug, flush])

    // Leaving the page, closing the dialog or switching to another one never drops a keystroke.
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current)
            if (!inFlight.current && !(dirty.current && !conflicted.current)) return
            const last = (inFlight.current ?? Promise.resolve()).then(() => (dirty.current && !conflicted.current ? write() : undefined)).catch(() => {})
            pendingSaves.set(page.slug, last)
            void last.finally(() => {
                if (pendingSaves.get(page.slug) === last) pendingSaves.delete(page.slug)
            })
        },
        [write, page.slug],
    )

    return { status, error, conflictWith, edit, flush, loadTheirs, keepMine }
}
