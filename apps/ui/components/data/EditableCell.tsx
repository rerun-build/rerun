'use client'

import { FriendlyCell } from '@/components/data/FriendlyCell'
import { isNumericKind, type FriendlyColumn } from '@/lib/data/friendly-columns'
import { cellInputText } from '@/lib/data/views'
import { cn } from '@/lib/utils'
import { formatCell, type CellContext } from '@rerun/ui/chat'
import { useState, type ReactNode } from 'react'

type EditableCellProps = {
    value: unknown
    column: FriendlyColumn
    format?: string
    context: CellContext
    currency?: string
    onCommit?: (text: string) => Promise<boolean>
    adornment?: ReactNode
}

export function EditableCell({ value, column, format, context, currency, onCommit, adornment }: EditableCellProps) {
    const [draft, setDraft] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const commit = async () => {
        if (draft === null || !onCommit) return
        if (draft === cellInputText(value)) {
            setDraft(null)
            return
        }
        setSaving(true)
        const saved = await onCommit(draft)
        setSaving(false)
        if (saved) setDraft(null)
    }

    if (draft !== null) {
        return (
            <input
                autoFocus
                value={draft}
                disabled={saving}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={event => {
                    if (event.key === 'Enter') {
                        event.preventDefault()
                        void commit()
                    }
                    if (event.key === 'Escape') setDraft(null)
                }}
                className="-my-0.5 h-6 w-full min-w-24 rounded border border-primary/40 bg-background px-1.5 text-[13px] outline-none ring-1 ring-primary/30"
            />
        )
    }

    return (
        <div
            onDoubleClick={onCommit ? () => setDraft(cellInputText(value)) : undefined}
            title={cellInputText(value)}
            className={cn('flex min-h-5 min-w-0 items-center truncate', isNumericKind(column.kind) && !format && 'justify-end', adornment && 'gap-2', onCommit && 'cursor-text')}
        >
            {format ? formatCell(value, format, context) : <FriendlyCell value={value} column={column} currency={currency} tones={context.tones} />}
            {adornment}
        </div>
    )
}
