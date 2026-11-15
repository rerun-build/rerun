'use client'

import { Caret } from '@rerun/ui/new-agent'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { FormControl, FormField, FormItem } from '@/components/ui/form'
import { BOX_NAME_MAX } from '@/lib/board/types'
import { ArrowRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { NameChips } from './NameChips'
import { NamePlaceholder } from './NamePlaceholder'
import type { PlaceholderEffect } from './placeholder-effects'
import type { BoxDraft } from './useBoxDraft'

export function BoxComposer({ draft, suggestions, placeholderEffect, controls, creating, error, autoFocus, drawnCaret, className }: { draft: BoxDraft; suggestions: string[]; placeholderEffect: PlaceholderEffect; controls?: ReactNode; creating: boolean; error?: string; autoFocus: boolean; drawnCaret: boolean; className?: string }) {
    const t = useTranslations('dialogs.newBox')
    return (
        <div className={className}>
            <div className="relative z-30 w-full rounded-2xl border border-black/[0.07] bg-popover px-4 pt-4 pb-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_24px_56px_-28px_rgba(50,50,110,0.3)] dark:border-white/[0.08] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_2px_6px_rgba(0,0,0,0.25),0_28px_70px_-20px_rgba(0,0,0,0.8)]">
                <FormField control={draft.form.control} name="name" render={() => <NameInput name={draft.name} onName={draft.setName} suggestions={suggestions} placeholderEffect={placeholderEffect} autoFocus={autoFocus} drawnCaret={drawnCaret} />} />
                <div className="mt-4 flex items-center gap-2">
                    <div className="-ml-1 min-w-0 flex-1">{controls}</div>
                    <Button type="submit" data-aim="create" disabled={!draft.named || creating} className="max-w-[75%] shrink-0">
                        <span className="truncate">{creating ? t('creating') : draft.named ? t('createNamed', { name: draft.trimmed }) : t('create')}</span>
                        <ArrowRightIcon className="size-3.5" />
                    </Button>
                </div>
            </div>
            {error && (
                <p role="alert" className="mt-3 text-center text-sm text-destructive">
                    {error}
                </p>
            )}
            <NameChips names={suggestions} picked={suggestions.includes(draft.trimmed) ? draft.trimmed : null} onPick={draft.pick} className="mt-4" />
        </div>
    )
}

const ZERO_WIDTH_SPACE = '\u200b'

function NameInput({ name, onName, suggestions, placeholderEffect, autoFocus, drawnCaret }: { name: string; onName: (name: string) => void; suggestions: string[]; placeholderEffect: PlaceholderEffect; autoFocus: boolean; drawnCaret: boolean }) {
    const t = useTranslations('dialogs.newBox')
    const type = 'px-1 text-2xl font-medium tracking-tight whitespace-pre'
    return (
        <FormItem className="relative block overflow-hidden">
            <p aria-hidden className={cn(type, 'pointer-events-none', name && !drawnCaret && 'invisible')}>
                {name ? name : (
                    <span className="text-muted-foreground/45">
                        {drawnCaret && <Caret className="mr-px" />}
                        {ZERO_WIDTH_SPACE}
                        <NamePlaceholder names={suggestions} effect={drawnCaret ? 'static' : placeholderEffect} />
                    </span>
                )}
                {name && drawnCaret && <Caret className="ml-px" />}
            </p>
            <FormControl>
                <input value={name} onChange={event => onName(event.target.value)} aria-label={t('nameLabel')} maxLength={BOX_NAME_MAX} autoFocus={autoFocus} autoComplete="off" spellCheck={false} className={cn(type, 'absolute inset-0 size-full bg-transparent outline-none selection:bg-foreground/20', drawnCaret ? 'text-transparent caret-transparent' : 'caret-foreground')} />
            </FormControl>
        </FormItem>
    )
}
