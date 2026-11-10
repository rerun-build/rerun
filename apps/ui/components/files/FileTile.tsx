'use client'

import { Input } from '@/components/ui/input'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { GlobeIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'

type RenameInputProps = {
    name: string
    onSubmit?: (next: string) => void
    onCancel?: () => void
}

// Mounted only while renaming, so the current name is the initial state and no effect has to
// push it back in.
function RenameInput({ name, onSubmit, onCancel }: RenameInputProps) {
    const [value, setValue] = useState(name)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])

    const submit = () => {
        const next = value.trim()
        if (next && next !== name) onSubmit?.(next)
        else onCancel?.()
    }

    return (
        <Input
            ref={inputRef}
            value={value}
            onChange={event => setValue(event.target.value)}
            onBlur={submit}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
                event.stopPropagation()
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') onCancel?.()
            }}
            className="h-6 w-full px-1 text-center text-xs"
        />
    )
}

type FileTileProps = {
    name: string
    glyph: ReactNode
    title?: string
    published?: boolean
    renaming?: boolean
    onOpen: () => void
    onContextMenu?: () => void
    onRenameSubmit?: (next: string) => void
    onRenameCancel?: () => void
}

export function FileTile({ name, glyph, title, published, renaming, onOpen, onContextMenu, onRenameSubmit, onRenameCancel }: FileTileProps) {
    const t = useTranslations('files')
    return (
        <div
            role="button"
            tabIndex={0}
            title={title ?? name}
            onClick={onOpen}
            onContextMenu={onContextMenu}
            onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpen()
            }}
            className="group flex cursor-default select-none flex-col items-center gap-1.5 rounded-md border border-transparent p-2 outline-none transition-colors hover:border-border/70 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
            <div className="relative">
                {glyph}
                {published && (
                    <TooltipLabeled label={t('publish.publicLink')}>
                        <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-background">
                            <GlobeIcon className="size-3 text-emerald-400" aria-label={t('grid.published')} />
                        </span>
                    </TooltipLabeled>
                )}
            </div>
            {renaming ? (
                <RenameInput name={name} onSubmit={onRenameSubmit} onCancel={onRenameCancel} />
            ) : (
                <span className="line-clamp-2 max-w-full rounded px-1 text-center text-xs leading-tight break-all">{name}</span>
            )}
        </div>
    )
}
