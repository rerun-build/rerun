'use client'

import { useErrorText } from '@/hooks/useErrorText'
import type { SaveFileResult } from '@/app/api/_services/file.service'
import { applyEol, hashText, splitEol, type Eol } from '@/lib/files/editable'
import { useCallback, useEffect, useState } from 'react'

type UseFileDraftProps = {
    initialContent: string
    onSave: (content: string, baseHash: string | null) => Promise<SaveFileResult>
    onSaved: (content: string) => void
}

export type FileDraft = {
    draft: string
    dirty: boolean
    saving: boolean
    error: string | null
    conflict: boolean
    setDraft: (next: string) => void
    save: () => void
    overwrite: () => void
    dismissConflict: () => void
}

export function useFileDraft({ initialContent, onSave, onSaved }: UseFileDraftProps): FileDraft {
    const [opened, setOpened] = useState(() => splitEol(initialContent))
    const [draft, setDraft] = useState(opened.text)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const errorText = useErrorText()
    const [conflict, setConflict] = useState(false)

    const dirty = draft !== opened.text

    // The browser only asks about a tab being closed; leaving the panel is guarded by the caller.
    useEffect(() => {
        if (!dirty) return
        const warn = (event: BeforeUnloadEvent) => event.preventDefault()
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    const run = useCallback(
        async (eol: Eol, baseHash: string | null) => {
            const content = applyEol(draft, eol)
            setSaving(true)
            setError(null)
            const result = await onSave(content, baseHash)
            setSaving(false)
            if (result.success) {
                setOpened({ text: draft, eol })
                setConflict(false)
                onSaved(content)
                return
            }
            if (result.conflict) setConflict(true)
            else setError(errorText(result))
        },
        [draft, onSave, onSaved, errorText],
    )

    const save = useCallback(() => {
        if (saving) return
        void run(opened.eol, hashText(applyEol(opened.text, opened.eol)))
    }, [run, saving, opened])

    const overwrite = useCallback(() => {
        setConflict(false)
        void run(opened.eol, null)
    }, [run, opened])

    const dismissConflict = useCallback(() => setConflict(false), [])

    return { draft, dirty, saving, error, conflict, setDraft, save, overwrite, dismissConflict }
}
