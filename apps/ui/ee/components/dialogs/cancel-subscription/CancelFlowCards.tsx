import type { CancelFlowAgent } from '@/ee/services/cancel-flow-activity.service'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { ClockIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { BorderBeam, TextShimmer } from '@rerun/ui'
import { Icon, PANEL_CARD, Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import { BRAND_TEXT } from './CancelTimeline'

export type IconType = ComponentType<SVGProps<SVGSVGElement>>

const FEATURED_AGENTS = 3

export function DaysLeftCard({ trial, daysLeft, agents, loading }: { trial: boolean; daysLeft: number; agents: readonly CancelFlowAgent[]; loading: boolean }) {
    const featured = agents.slice(0, FEATURED_AGENTS)
    const tiles = loading ? FEATURED_AGENTS : featured.length
    const t = useTranslations('billing')
    const days = (chunks: ReactNode) => <span className={cn('font-semibold', BRAND_TEXT)}>{chunks}</span>

    return (
        <div className={cn('relative flex flex-col gap-3 overflow-hidden p-3', PANEL_CARD)}>
            <Stripes fade="bottom" />
            <p className="relative flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <ClockIcon className="size-4 shrink-0" />
                <span>{trial ? t.rich('cancel.daysLeft.trial', { count: daysLeft, days }) : t.rich('cancel.daysLeft.paid', { count: daysLeft, days })}</span>
            </p>
            {tiles > 0 && (
                <div className={cn('relative grid grid-cols-2 gap-2', tiles === 3 && 'sm:grid-cols-3')}>
                    {loading
                        ? Array.from({ length: FEATURED_AGENTS }, (_, index) => (
                              <div key={index} className={cn('flex flex-col gap-1 rounded-lg bg-muted/60 p-3', index === 2 && 'hidden sm:flex')}>
                                  <Skeleton className="h-5 w-24" />
                                  <Skeleton className="h-4 w-20" />
                              </div>
                          ))
                        : featured.map((agent, index) => (
                              <div key={agent.key} className={cn('flex min-w-0 flex-col gap-1 rounded-lg bg-muted/60 p-3', index === 2 && 'hidden sm:flex')}>
                                  <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
                                  <span className="text-xs text-muted-foreground">{t.rich(trial ? 'cancel.daysLeft.runsSoFar' : 'cancel.daysLeft.runsThisWeek', { count: agent.runsWeek, figure })}</span>
                              </div>
                          ))}
                </div>
            )}
        </div>
    )
}

function figure(chunks: ReactNode) {
    return <span className="font-medium text-foreground tabular-nums">{chunks}</span>
}

export type SunkStat = { icon: IconType; label: string; value: string | null }

// A stat whose figure did not come back is left out, unless it is still on its way.
export function SunkCard({ value, caption, stats, loading }: { value: string; caption: string; stats: readonly SunkStat[]; loading: boolean }) {
    const shown = stats.filter(stat => stat.value !== null || loading)

    return (
        <div className={cn('overflow-hidden', PANEL_CARD)}>
            <div className="relative flex flex-col items-center gap-1 px-5 pt-6 pb-5 text-center">
                <Stripes />
                {/* The clipped gradient only paints the line box: at the default leading of text-5xl the descender of a "g" falls outside it. */}
                <TextShimmer
                    duration={2.5}
                    spread={40}
                    className="relative text-5xl leading-tight font-semibold tracking-tight tabular-nums [--shimmer-base:var(--brand)] [--shimmer-highlight:#b7a8ff] dark:[--shimmer-base:#b7a8ff] dark:[--shimmer-highlight:white]"
                >
                    {value}
                </TextShimmer>
                <span className="relative text-sm text-muted-foreground">{caption}</span>
            </div>
            {shown.length > 0 && (
                <div className="flex flex-col gap-3 border-t px-5 py-4">
                    {shown.map(({ icon: StatIcon, value: statValue, label }) => (
                        <div key={label} className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                <StatIcon className="size-4" />
                                {label}
                            </span>
                            {statValue === null ? <Skeleton className="h-5 w-12" /> : <span className="font-heading text-base font-medium text-foreground tabular-nums">{statValue}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export function OfferCard({ headline, priceLabel, fullPriceLabel, billedOnLabel, terms }: { headline: string; priceLabel: string; fullPriceLabel: string; billedOnLabel: string; terms: string }) {
    const t = useTranslations('billing')
    return (
        <div className={cn('relative flex flex-col gap-3 rounded-xl p-5', PANEL_CARD)}>
            <BorderBeam pattern="arcs" tone="brand" animated glow width={1} duration={7} outset={1} />
            <span className="text-sm font-medium text-foreground">{headline}</span>
            <div className="flex items-baseline gap-2">
                <span className={cn('text-4xl font-semibold tracking-tight tabular-nums', BRAND_TEXT)}>{priceLabel}</span>
                <span className="text-sm text-muted-foreground line-through">{fullPriceLabel}</span>
                <span className="text-sm text-muted-foreground">{t('cancel.offerCard.billedOn', { date: billedOnLabel })}</span>
            </div>
            <p className="text-xs text-muted-foreground">{terms}</p>
        </div>
    )
}

export function CancelNote({ icon, title, description }: { icon: IconType; title: string; description: string }) {
    return (
        <Alert stripes className="grid-cols-[auto_1fr] gap-x-3 gap-y-0">
            <Icon icon={icon} size="sm" className="row-span-2 self-center" />
            <AlertTitle className="col-start-2 leading-tight">{title}</AlertTitle>
            <AlertDescription className="col-start-2 leading-snug">{description}</AlertDescription>
        </Alert>
    )
}
