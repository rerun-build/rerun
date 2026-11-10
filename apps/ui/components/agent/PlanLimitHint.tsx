'use client'

import { TooltipLabeled } from '@/components/ui/tooltip'
import { isCreditUsedUp, planLimitTone, planWindowPercent, tightestPlanWindow, type PlanLimitTone, type RerunCredit } from '@/lib/engine/ai-sources'
import { shortRelativeTime, shortUntil } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { PlanLimitWindow } from '@rerun/contracts'
import { shortDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'

const TONE_CLASS: Record<PlanLimitTone, string> = { brand: 'text-muted-foreground', warning: 'text-amber-500', destructive: 'text-destructive' }

// The badge counts down without a preposition ("5m", "3h"). shortRelativeTime reads that compact form
// for a past moment, so it is handed a "now" mirrored on the other side of the reset.
function compactUntil(iso: string, locale: string): string {
    const reset = new Date(iso).getTime()
    return shortRelativeTime(iso, locale, new Date(2 * reset - Date.now()))
}

function usePlanWindowName() {
    const t = useTranslations('agent.planLimitHint.windows')
    // OpenCode Go's rolling window is five hours long, and its plan says so.
    return (window: PlanLimitWindow, provider?: string) => {
        if (window.kind === 'session') return provider === 'opencode' ? t('fiveHour') : t('session')
        if (window.kind === 'weekly') return t('weekly')
        if (window.kind === 'monthly') return t('monthly')
        return window.label ? t('modelWeekly', { label: window.label }) : t('modelWeeklyUnnamed')
    }
}

// How far into its plan a subscription is, beside its name in a model picker. One figure for the
// whole group: the limits are the subscription's, every model under it draws on the same ones.
export function PlanLimitHint({ windows, provider }: { windows: PlanLimitWindow[]; provider?: string }) {
    const t = useTranslations('agent.planLimitHint')
    const locale = useLocale()
    const windowName = usePlanWindowName()
    const tightest = tightestPlanWindow(windows)
    if (!tightest) return null

    const detail = (
        <span className="flex flex-col gap-0.5">
            {windows.map(window => {
                const values = { name: windowName(window, provider), percent: planWindowPercent(window) }
                return (
                    <span key={`${window.kind}:${window.label ?? ''}`}>{window.resetsAt ? t('windowResets', { ...values, when: shortUntil(window.resetsAt, locale) }) : t('windowUsed', values)}</span>
                )
            })}
        </span>
    )

    return (
        <TooltipLabeled label={detail} side="right">
            <span className={cn('ml-auto shrink-0 pl-2 font-normal tabular-nums', TONE_CLASS[planLimitTone(tightest.usedPercent)])}>
                {planWindowPercent(tightest)}
                {tightest.resetsAt ? ` · ${compactUntil(tightest.resetsAt, locale)}` : ''}
            </span>
        </TooltipLabeled>
    )
}

// The same figure for the Rerun group, whose usage is the workspace's monthly credit rather than a
// plan's rate windows.
export function RerunCreditHint({ credit }: { credit: RerunCredit }) {
    const t = useTranslations('agent.planLimitHint')
    const tShared = useTranslations('agent.modelsShared')
    const locale = useLocale()

    if (credit.paused) {
        return (
            <TooltipLabeled label={tShared('creditPaused')} side="right">
                <span className="ml-auto shrink-0 pl-2 font-normal text-muted-foreground">{t('paused')}</span>
            </TooltipLabeled>
        )
    }
    if (credit.budgetMicros <= 0) return null

    const date = credit.resetAt ? shortDate(credit.resetAt, locale) : null
    const detail = isCreditUsedUp(credit)
        ? date
            ? t('credit.usedUpOn', { date })
            : t('credit.usedUpNextMonth')
        : date
          ? t('credit.usageOn', { percent: credit.percent, date })
          : t('credit.usageNextMonth', { percent: credit.percent })

    return (
        <TooltipLabeled label={detail} side="right">
            <span className={cn('ml-auto shrink-0 pl-2 font-normal tabular-nums', TONE_CLASS[planLimitTone(credit.percent)])}>
                {credit.percent}%{credit.resetAt ? ` · ${compactUntil(credit.resetAt, locale)}` : ''}
            </span>
        </TooltipLabeled>
    )
}
