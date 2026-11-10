'use client'

import { BorderBeam } from '@rerun/ui'
import { useLocale, useTranslations } from 'next-intl'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { BASE_PLAN_CREDITS, formatCredits } from '@/ee/lib/billing/plans'
import { ChevronRightIcon, CoinsIcon, PlusIcon, TriangleAlertIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { shortDate } from '../checkout-copy'
import { KindLegend, SplitBar } from './parts'
import { RerunCreditSwitch } from './RerunCreditSwitch'
import type { CreditUsageState } from './useCreditUsage'

// Out of credit, the card leads with it: the coworkers are stopped, and getting more is the one thing
// to do, so the button moves from the header into the alert. On a trial, more credit comes with Pro.
function OutOfCredits({ trial, resetsOn, onAdd }: { trial: boolean; resetsOn: Date | null; onAdd?: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    return (
        <Alert variant="danger" stripes className="flex items-center gap-4 rounded-xl px-4 py-3">
            <TriangleAlertIcon className="size-4 shrink-0" />
            <div className="min-w-0 flex-1">
                <AlertTitle>{trial ? t('usage.outOfCredits.trialTitle') : t('usage.outOfCredits.title')}</AlertTitle>
                <AlertDescription>{trial ? t('usage.outOfCredits.trialDescription', { count: BASE_PLAN_CREDITS }) : resetsOn ? t('usage.outOfCredits.descriptionUntil', { date: shortDate(resetsOn, locale) }) : t('usage.outOfCredits.description')}</AlertDescription>
            </div>
            {onAdd && (
                <Button size="sm" onClick={onAdd}>
                    {trial ? (
                        t('usage.card.startProNow')
                    ) : (
                        <>
                            <PlusIcon />
                            {t('usage.card.addCredits')}
                        </>
                    )}
                </Button>
            )}
        </Alert>
    )
}

// The Rerun credit under the plan: one bar split by what spent it, AI models and paid data, then
// what is left. The details are one click away, in the usage pane.
export function CreditCard({ credit, highlight = false, onAdd, onOpenUsage }: { credit: CreditUsageState; highlight?: boolean; onAdd?: () => void; onOpenUsage?: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const { balance, trial, resetsOn, paused } = credit
    const out = !paused && !!balance && balance.wholeMicros > 0 && balance.leftMicros <= 0

    return (
        <section className={cn('relative flex flex-col gap-4 rounded-2xl bg-background/60 p-5 ring-1 ring-border sm:p-6', highlight && 'ring-2 ring-foreground/40')}>
            <BorderBeam />
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <div className="flex min-w-0 flex-1 basis-64 items-center gap-4">
                    <Icon size="lg" icon={CoinsIcon} />
                    <div className="min-w-0">
                        <p className="text-base font-medium">{t('usage.card.title')}</p>
                        <p className="text-sm text-muted-foreground">{t('usage.card.subtitle')}</p>
                    </div>
                </div>
                {onAdd && !trial && !out && (
                    <Button variant="outline" size="sm" onClick={onAdd}>
                        <PlusIcon />
                        {t('usage.card.addCredits')}
                    </Button>
                )}
            </div>
            {out && <OutOfCredits trial={trial} resetsOn={resetsOn} onAdd={onAdd} />}
            {balance ? (
                <div className="flex flex-col gap-2.5">
                    <div className="flex items-baseline justify-between text-sm">
                        <span className="text-muted-foreground">{trial ? t('usage.card.usedTrial') : resetsOn ? t('usage.card.usedResets', { date: shortDate(resetsOn, locale) }) : t('usage.card.used')}</span>
                        <span className="tabular-nums">{t('usage.card.usedOf', { used: formatCredits(balance.usedAiMicros + balance.usedDataMicros, locale), whole: formatCredits(balance.wholeMicros, locale) })}</span>
                    </div>
                    <SplitBar balance={balance} trial={trial} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <KindLegend balance={balance} />
                        {onOpenUsage && (
                            <button type="button" onClick={onOpenUsage} className="flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                                {t('usage.card.seeUsage')}
                                <ChevronRightIcon className="size-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-2.5">
                    <div className="flex items-baseline justify-between">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-2.5 w-full rounded-full" />
                    <Skeleton className="h-3.5 w-56" />
                </div>
            )}
            <div className="border-t pt-4">
                <RerunCreditSwitch paused={paused} />
            </div>
        </section>
    )
}
