'use client'

import { CONVERSATION_TITLE_MAX } from '@rerun/contracts'
import { useRenameField } from '@rerun/ui/forms'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type RenameStatus = 'editing' | 'saving' | 'error'

// `focus`: a rename someone starts takes the focus; one drawn already open must leave it where it is.
export type SessionRenameState = { id: string; status: RenameStatus; focus: boolean }

/**
 * The conversation being renamed in one surface, and how far its save got. The field waits for the
 * answer: it closes once the title is saved, and stays open on what was typed when the save failed.
 */
export function useSessionRename(onRename: (id: string, title: string) => Promise<boolean>, initial: SessionRenameState | null = null) {
    const [rename, setRename] = useState<SessionRenameState | null>(initial)

    const start = (id: string) => setRename({ id, status: 'editing', focus: true })
    const cancel = () => setRename(null)
    const submit = async (id: string, title: string) => {
        setRename(current => current && { ...current, status: 'saving' })
        const renamed = await onRename(id, title).catch(() => false)
        // A save that comes back after another rename started says nothing about that one.
        setRename(current => (current?.id !== id ? current : renamed ? null : { ...current, status: 'error' }))
    }

    return { rename, start, cancel, submit }
}

export type SessionRename = ReturnType<typeof useSessionRename>

type RenameFieldProps = { title: string; status: RenameStatus; focus: boolean; onSubmit: (title: string) => void; onCancel: () => void }

function useSessionRenameField({ title, status, focus, onSubmit, onCancel }: RenameFieldProps) {
    const t = useTranslations('agent.sessionRename')
    const busy = status === 'saving'
    const { inputProps } = useRenameField({ name: title, onSubmit, onCancel, busy, focus })
    // Read-only rather than disabled while it saves: a disabled field drops the focus, and a save that
    // failed would then need a click before Enter can try again.
    return { busy, fieldProps: { ...inputProps, maxLength: CONVERSATION_TITLE_MAX, readOnly: busy, 'aria-invalid': status === 'error' || undefined, 'aria-label': t('label') } }
}

// The ring is inset: the row of tabs scrolls, and would clip one drawn outside the field.
export function TabRenameField(props: RenameFieldProps) {
    const { busy, fieldProps } = useSessionRenameField(props)
    return (
        <div className={cn('flex h-7 shrink-0 items-center gap-1 rounded-md bg-background pl-2 pr-1.5 text-xs ring-1 ring-inset', props.status === 'error' ? 'ring-destructive' : 'ring-primary')}>
            <input {...fieldProps} className="field-sizing-content min-w-16 max-w-[220px] bg-transparent outline-none selection:bg-foreground/20 read-only:opacity-60" />
            {busy && <Spinner className="size-3 text-muted-foreground" />}
        </div>
    )
}

export function ChatRowRenameField(props: RenameFieldProps) {
    const t = useTranslations('agent.sessionRename')
    const { busy, fieldProps } = useSessionRenameField(props)
    return (
        <div className="flex flex-col gap-1 px-1 py-1">
            <div className="relative">
                <Input {...fieldProps} className="h-9 pr-8 read-only:opacity-50" />
                {busy && <Spinner className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />}
            </div>
            {props.status === 'error' && (
                <p role="alert" className="px-1 text-[11px] text-destructive">
                    {t('failed')}
                </p>
            )}
        </div>
    )
}
