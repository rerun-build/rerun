'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { SearchIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

// `/` reaches the field from anywhere in the library, except from another field.
export function TemplateLibrarySearch({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
    const t = useTranslations('templates.library.search')
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
            const target = event.target as HTMLElement | null
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
            event.preventDefault()
            inputRef.current?.focus()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [])

    return (
        <label className={cn('flex h-8 items-center gap-2 rounded-lg border bg-background/40 px-2.5 transition-colors focus-within:border-ring', className)}>
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input
                ref={inputRef}
                value={value}
                onChange={event => onChange(event.target.value)}
                placeholder={t('placeholder')}
                aria-label={t('placeholder')}
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-hidden placeholder:text-muted-foreground"
            />
            {value ? (
                <button type="button" aria-label={t('clear')} onClick={() => onChange('')} className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                    <XIcon className="size-3" />
                </button>
            ) : (
                <kbd className="hidden h-4.5 min-w-4.5 items-center justify-center rounded border px-1 font-sans text-[10px] text-muted-foreground sm:inline-flex">/</kbd>
            )}
        </label>
    )
}
