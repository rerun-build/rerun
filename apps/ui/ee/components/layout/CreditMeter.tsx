'use client'

import { useLocale, useTranslations } from 'next-intl'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { formatCredits } from '@/ee/lib/billing/plans'
import { PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type CreditTone = 'ok' | 'low' | 'out'

const LOW_SHARE = 0.15

// `!` because the menu item forces its children to the accent colour on focus, which would wash the warning out.
const TONE_TEXT: Record<CreditTone, string> = { ok: 'text-foreground', low: 'text-destructive!', out: 'text-destructive!' }

function toneOf(leftMicros: number, wholeMicros: number): CreditTone {
    if (leftMicros <= 0) return 'out'
    return leftMicros / wholeMicros < LOW_SHARE ? 'low' : 'ok'
}

// The Rerun credit at a glance in the workspace menu: coworkers spend it without asking, so what is
// left has to be one click away. The split by AI and paid data stays in the billing dialog.
export function CreditMeter({ usedMicros, wholeMicros, trial, onOpen, onAdd }: { usedMicros: number; wholeMicros: number; trial: boolean; onOpen: () => void; onAdd?: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const leftMicros = Math.max(wholeMicros - usedMicros, 0)
    const tone = toneOf(leftMicros, wholeMicros)
    const ratio = Math.min(usedMicros / wholeMicros, 1)
    const left = tone === 'out' ? (trial ? t('layout.meter.noTrialCreditsLeft') : t('layout.meter.outOfCredits')) : t('layout.meter.left', { figure: formatCredits(leftMicros, locale) })

    return (
        <>
            <DropdownMenuItem onSelect={onOpen} className="-mx-1.5 flex-col items-stretch gap-1.5 text-xs">
                <span className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground">{trial ? t('layout.meter.trialCredits') : t('layout.meter.credits')}</span>
                    <span className={cn('truncate tabular-nums', TONE_TEXT[tone])}>
                        {left}
                    </span>
                </span>
                <span role="progressbar" aria-label={t('layout.meter.ariaUsed')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/20">
                    <span className={cn('block h-full rounded-full transition-[width] duration-500', tone === 'ok' ? 'bg-brand' : 'bg-destructive')} style={{ width: `${Math.max(ratio * 100, usedMicros > 0 ? 2 : 0)}%` }} />
                </span>
            </DropdownMenuItem>
            {tone === 'out' && onAdd && (
                <DropdownMenuItem onSelect={onAdd} className="h-7 justify-center gap-1.5 rounded-md bg-primary text-xs text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground">
                    {trial ? (
                        t('usage.card.startProNow')
                    ) : (
                        <>
                            <PlusIcon className="size-3.5" />
                            {t('usage.card.addCredits')}
                        </>
                    )}
                </DropdownMenuItem>
            )}
        </>
    )
}
