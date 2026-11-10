'use client'

import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { PencilIcon } from '../icons'
import { cn } from '../cn'
import { useKitTranslations } from '../locale'

import { AgentTile } from './marks'
import { AGENT_NAME_MAX } from './reading'

// The agent's name rides in the field. Empty it says where the name goes; once Rerun reads a name in
// the description, or a suggestion brings its own, the tile lights and the pencil says it can be
// changed. A click turns the pill into a field of the same size; Enter keeps the name, Escape drops
// the edit, and an emptied name gives the naming back to the description.
export function NamePill({ name, editing, onEdit, onRename, onCancel }: { name: string | null; editing: boolean; onEdit: () => void; onRename: (name: string) => void; onCancel: () => void }) {
    const t = useKitTranslations()
    const pill = 'mr-1 inline-flex h-7 max-w-56 min-w-0 shrink-0 items-center @max-[24rem]:min-w-0 @max-[24rem]:shrink gap-1.5 rounded-full border pl-1.5 text-[0.8rem] font-medium whitespace-nowrap'

    if (editing) return <EditingPill className={pill} name={name ?? ''} onRename={onRename} onCancel={onCancel} />

    return (
        <button type="button" data-aim="name" onClick={onEdit} className={cn(pill, 'group/name pr-2 transition-colors', name ? 'border-foreground/15 bg-muted/50 text-foreground hover:bg-muted' : 'border-border pr-2.5 text-muted-foreground hover:text-foreground')}>
            <AgentTile lit={Boolean(name)} className="size-[18px] shrink-0" />
            {/* Keyed on the name, so a name that changes while one writes arrives rather than swaps. */}
            <span key={name ?? ''} className={cn('truncate', name && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300')}>
                {name ?? t('newAgent.name.placeholder')}
            </span>
            {name && <PencilIcon className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover/name:text-foreground" />}
        </button>
    )
}

function EditingPill({ className, name, onRename, onCancel }: { className: string; name: string; onRename: (name: string) => void; onCancel: () => void }) {
    const t = useKitTranslations()
    const [draft, setDraft] = useState(name)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Enter') onRename(draft.trim())
        if (event.key === 'Escape') onCancel()
    }

    return (
        <span data-aim="name" className={cn(className, 'border-foreground/30 bg-background pr-2.5 text-foreground ring-3 ring-ring/25')}>
            <AgentTile lit className="size-[18px] shrink-0" />
            <input ref={inputRef} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={() => onRename(draft.trim())} aria-label={t('newAgent.name.label')} placeholder={t('newAgent.name.placeholder')} maxLength={AGENT_NAME_MAX} className="field-sizing-content max-w-full min-w-16 bg-transparent outline-none selection:bg-foreground/20 placeholder:text-muted-foreground" />
        </span>
    )
}
