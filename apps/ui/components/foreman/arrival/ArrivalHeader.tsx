'use client'

import { TRIAL_DAYS, type TemplateConnector } from '@rerun/contracts'
import { StepperBar, StepTransition } from '@rerun/ui/steps'
import { useTranslations } from 'next-intl'

import { TemplateCardThumbnail } from '@/components/templates/TemplateCardThumbnail'
import { TemplateConnectorLogos } from '@/components/templates/TemplateConnectorLogos'
import { Check } from '@/lib/icons'
import type { TemplateCardImage } from '@/lib/templates/card-image'
import { cn } from '@/lib/utils'

import { arrivalGestures, gestureIndex, type ArrivalStep } from './flow'

// `name` is what the headings call it: the coworker's own name when there is one to give.
export type ArrivalPick = { title: string; name?: string; by?: string | null; image?: TemplateCardImage | null; connectors?: TemplateConnector[] }

// What the visitor came for, carried on every screen until it is running: the one thing that tells
// them this account, this card and this wait are all about what they picked.
export function ArrivalPassport({ pick, className }: { pick: ArrivalPick; className?: string }) {
    const t = useTranslations('foreman.arrival')
    return (
        <div className={cn('flex items-center gap-3', className)}>
            {pick.image && <TemplateCardThumbnail image={pick.image} className="aspect-[1200/630] w-24 shrink-0 rounded-lg ring-1 ring-foreground/10" />}
            <div className="min-w-0">
                <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t('youPicked')}</p>
                <p className="truncate text-sm font-semibold text-foreground">{pick.title}</p>
                {(pick.by || !!pick.connectors?.length) && (
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {pick.by && <span className="truncate">{t('by', { name: pick.by })}</span>}
                        {!!pick.connectors?.length && <TemplateConnectorLogos connectors={pick.connectors} />}
                    </p>
                )}
            </div>
        </div>
    )
}

export function GestureRail({ step, paid = false, className }: { step: ArrivalStep; paid?: boolean; className?: string }) {
    const t = useTranslations('foreman.arrival.gestures')
    const gestures = arrivalGestures(paid)
    const current = gestureIndex(step, paid)

    return (
        <div className={className}>
            <StepperBar count={gestures.length} current={current} />
            <ol className="mt-2 flex gap-1.5">
                {gestures.map((gesture, index) => (
                    <li key={gesture} className={cn('flex flex-1 items-center gap-1 text-[11px]', index === current ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                        {index < current && <Check className="size-3" />}
                        {t(gesture)}
                    </li>
                ))}
            </ol>
        </div>
    )
}

/** The top of the column for the whole arrival: where they are, what they picked, and what this step is for. */
export function ArrivalHeader({ pick, step, paid, className }: { pick: ArrivalPick; step: ArrivalStep; paid?: boolean; className?: string }) {
    const t = useTranslations('foreman.arrival.headings')
    const name = pick.name ?? pick.title
    const title = t(`${step}.title`, { name, days: TRIAL_DAYS })
    const description = t(`${step}.description`, { name })

    return (
        <div className={cn('flex shrink-0 flex-col gap-4', className)}>
            <GestureRail step={step} paid={paid} />
            <ArrivalPassport pick={pick} className="rounded-xl border border-border bg-muted/20 p-3" />
            <StepTransition stepKey={step} direction={1} className="flex flex-col gap-1.5">
                <h2 className="text-xl leading-tight font-medium tracking-tight text-balance">{title}</h2>
                <p className="text-sm text-muted-foreground text-balance">{description}</p>
            </StepTransition>
        </div>
    )
}
