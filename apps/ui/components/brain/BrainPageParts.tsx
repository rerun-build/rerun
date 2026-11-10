'use client'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import { CheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { brainPageTypeSchema, type BrainPageType } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

// The reading column every brain page sits in, centred with the margins Notion gives a page.
export function PageColumn({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('mx-auto w-full max-w-[720px] px-6 pb-24 pt-8 sm:px-12 sm:pt-12', className)}>{children}</div>
}

export function PageTypeIcon({ type }: { type: BrainPageType }) {
    return <Icon icon={BRAIN_PAGE_ICONS[type]} size="lg" className="mb-4" />
}

type PageTitleProps = {
    value: string
    autoFocus?: boolean
    readOnly?: boolean
    onChange: (value: string) => void
    onCommit?: () => void
    onEnter?: () => void
}

// A heading you type into: no border, grows with what it holds, Enter moves on to the body.
export function PageTitle({ value, autoFocus, readOnly, onChange, onCommit, onEnter }: PageTitleProps) {
    const t = useTranslations('brain.parts')
    const ref = useRef<HTMLTextAreaElement>(null)

    useLayoutEffect(() => {
        const element = ref.current
        if (!element) return
        element.style.height = '0px'
        element.style.height = `${element.scrollHeight}px`
    }, [value])

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
            event.currentTarget.blur()
            return
        }
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
        event.preventDefault()
        onCommit?.()
        onEnter?.()
    }

    return (
        <textarea
            ref={ref}
            rows={1}
            value={value}
            autoFocus={autoFocus}
            readOnly={readOnly}
            maxLength={120}
            placeholder={t('untitled')}
            aria-label={t('pageTitle')}
            onChange={event => onChange(event.target.value.replace(/\n/g, ' '))}
            onBlur={onCommit}
            onKeyDown={handleKeyDown}
            className="block w-full resize-none overflow-hidden bg-transparent text-[2rem] font-semibold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
        />
    )
}

export function PageProperty({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-h-8 items-center gap-2 text-sm">
            <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
        </div>
    )
}

// The sections the seed imported from the public web: the coworkers take them as a guess until a
// person edits or confirms them.
export function UnconfirmedSections({ headings, confirming, onConfirm }: { headings: string[]; confirming: boolean; onConfirm: () => void }) {
    const t = useTranslations('brain.parts')
    return (
        <PageProperty label={t('unconfirmed')}>
            {headings.map(heading => (
                <Badge key={heading} size="xs" tone="yellow" glow={false} fill="outline" className="max-w-full min-w-0">
                    <span className="truncate">{heading}</span>
                </Badge>
            ))}
            <Button size="xs" loading={confirming} onClick={onConfirm}>
                <CheckIcon />
                {t('confirm')}
            </Button>
        </PageProperty>
    )
}

export function PageTypeSelect({ value, disabled, onChange }: { value: BrainPageType; disabled?: boolean; onChange: (type: BrainPageType) => void }) {
    const t = useTranslations('brain')
    return (
        <Select value={value} onValueChange={next => onChange(next as BrainPageType)} disabled={disabled}>
            <SelectTrigger size="sm" className="-ml-2 border-transparent bg-transparent shadow-none hover:bg-accent dark:bg-transparent dark:hover:bg-accent" aria-label={t('parts.pageType')}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {brainPageTypeSchema.options.map(type => {
                    const Glyph = BRAIN_PAGE_ICONS[type]
                    return (
                        <SelectItem key={type} value={type}>
                            <Glyph className="size-3.5 text-muted-foreground" />
                            {t(`pageTypes.${type}`)}
                        </SelectItem>
                    )
                })}
            </SelectContent>
        </Select>
    )
}
