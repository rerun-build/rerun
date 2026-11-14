'use client'

import type { ReactNode } from 'react'

import { cn } from '../cn'

import { FieldFooter, type FieldFooterProps } from './FieldFooter'
import { JobField } from './JobField'
import { FieldLight } from './OrbLight'

export function Composer({ text, onText, onSubmit, mark, preview, drawnCaret = false, placeholder, maxLength, className, ...footer }: FieldFooterProps & { text: string; onText: (text: string) => void; onSubmit: () => void; mark: string | null; preview?: string | null; drawnCaret?: boolean; placeholder?: ReactNode; maxLength?: number; className?: string }) {
    return (
        <form
            onSubmit={event => {
                event.preventDefault()
                onSubmit()
            }}
            className={cn('relative rounded-2xl border border-black/[0.07] bg-popover px-4 pt-4 pb-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_24px_56px_-28px_rgba(50,50,110,0.3)] dark:border-white/[0.08] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_2px_6px_rgba(0,0,0,0.25),0_28px_70px_-20px_rgba(0,0,0,0.8)]', className)}
        >
            <FieldLight focused={text.trim() !== ''} />
            <JobField text={text} onText={onText} onSubmit={onSubmit} mark={mark} preview={preview} drawnCaret={drawnCaret} placeholder={placeholder} maxLength={maxLength} className="min-h-[72px]" />
            <div className="relative mt-3">
                <FieldFooter {...footer} />
            </div>
        </form>
    )
}
