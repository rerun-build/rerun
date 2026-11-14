'use client'

import type { KeyboardEvent, MouseEvent } from 'react'

import { cn } from '@/lib/utils'

export function intakeFieldHandlers(onEnter: () => void) {
    return {
        onClick: (event: MouseEvent<HTMLInputElement>) => event.stopPropagation(),
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
            event.stopPropagation()
            if (event.key !== 'Enter') return
            event.preventDefault()
            onEnter()
        },
    }
}

export function IntakeField({ id, value, placeholder, disabled, autoFocus, onChange, onEnter, className }: { id?: string; value: string; placeholder: string; disabled?: boolean; autoFocus?: boolean; onChange: (value: string) => void; onEnter: () => void; className?: string }) {
    return (
        <input
            id={id}
            autoFocus={autoFocus}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={event => onChange(event.target.value)}
            {...intakeFieldHandlers(onEnter)}
            className={cn('min-h-7 w-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground', className)}
        />
    )
}
