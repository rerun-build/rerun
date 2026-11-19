'use client'

import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { PencilIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

/**
 * A name that turns into a field on click: Enter or leaving the field saves it, Escape gives up.
 * `allowEmpty` hands an emptied field back as '', for a name that falls back to a default.
 */
export function EditableName({ name, onRename, label, maxLength, allowEmpty = false, className }: { name: string; onRename: (name: string) => void; label?: string; maxLength?: number; allowEmpty?: boolean; className?: string }) {
    const [draft, setDraft] = useState<string | null>(null)

    if (draft !== null) {
        const commit = () => {
            const next = draft.trim()
            if ((next || allowEmpty) && next !== name) onRename(next)
            setDraft(null)
        }
        return (
            <Input
                autoFocus
                aria-label={label}
                value={draft}
                maxLength={maxLength}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') setDraft(null)
                }}
                className="h-7 text-sm"
            />
        )
    }

    return (
        <button type="button" aria-label={label} onClick={() => setDraft(name)} className="group/name inline-flex min-w-0 max-w-full items-center gap-1.5 text-left">
            <span className={cn('truncate text-sm font-medium', className)}>{name}</span>
            <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100 group-focus-visible/name:opacity-100 [@media(hover:none)]:opacity-100" />
        </button>
    )
}
