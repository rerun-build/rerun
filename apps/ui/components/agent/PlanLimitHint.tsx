'use client'

import { TooltipLabeled } from '@/components/ui/tooltip'
import { isCreditUsedUp, planLimitTone, planWindowPercent, tightestPlanWindow, type PlanLimitTone, type MoldwrightCredit } from '@/lib/engine/ai-sources'
import { shortRelativeTime, shortUntil } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { PlanLimitWindow } from '@moldwright/contracts'
import { shortDate } from '@moldwright/i18n/format'
import { useLocale, useTranslations } from 'next-intl'

const TONE_CLASS: Record<PlanLimitTone, string> = { brand: 'text-muted-foreground', warning: 'text-amber-500', destructive: 'text-destructive' }

function compactUntil(iso: string, locale: string): string {
    const reset = new Date(iso).getTime()
    return shortRelativeTime(iso, locale, new Date(2 * reset - Date.now()))
}

function usePlanWindowName() {
    const t = useTranslations('agent.planLimitHint.windows')
    return (window: PlanLimitWindow, provider?: string) => {
        if (window.kind === 'session') return provider === 'opencode' ? t('fiveHour') : t('session')
        if (window.kind === 'weekly') return t('weekly')
        if (window.kind === 'monthly') return t('monthly')
        return window.label ? t('modelWeekly', { label: window.label }) : t('modelWeeklyUnnamed')
    }
}

export function PlanLimitDetail({ windows, provider }: { windows: PlanLimitWindow[]; provider?: string }) {
    const t = useTranslations('agent.planLimitHint')
    const locale = useLocale()
    const windowName = usePlanWindowName()
    return (
        <span className="flex flex-col gap-0.5">
            {windows.map(window => {
                const values = { name: windowName(window, provider), percent: planWindowPercent(window) }
                return (
                    <span key={`${window.kind}:${window.label ?? ''}`}>{window.resetsAt ? t('windowResets', { ...values, when: shortUntil(window.resetsAt, locale) }) : t('windowUsed', values)}</span>
                )
            })}
        </span>
    )
}

export function usePlanWindowsSummary() {
    const t = useTranslations('agent.planLimitHint')
    const windowName = usePlanWindowName()
    return (windows: PlanLimitWindow[], provider?: string) => windows.map(window => t('windowUsed', { name: windowName(window, provider), percent: planWindowPercent(window) })).join(', ')
}

export function useMoldwrightCreditDetail() {
    const t = useTranslations('agent.planLimitHint')
    const locale = useLocale()
    return (credit: MoldwrightCredit) => {
        const date = credit.resetAt ? shortDate(credit.resetAt, locale) : null
        if (isCreditUsedUp(credit)) return date ? t('credit.usedUpOn', { date }) : t('credit.usedUpNextMonth')
        return date ? t('credit.usageOn', { percent: credit.percent, date }) : t('credit.usageNextMonth', { percent: credit.percent })
    }
}

export function PlanLimitHint({ windows, provider }: { windows: PlanLimitWindow[]; provider?: string }) {
    const locale = useLocale()
    const tightest = tightestPlanWindow(windows)
    if (!tightest) return null

    return (
        <TooltipLabeled label={<PlanLimitDetail windows={windows} provider={provider} />} side="right">
            <span className={cn('ml-auto shrink-0 pl-2 font-normal tabular-nums', TONE_CLASS[planLimitTone(tightest.usedPercent)])}>
                {planWindowPercent(tightest)}
                {tightest.resetsAt ? ` · ${compactUntil(tightest.resetsAt, locale)}` : ''}
            </span>
        </TooltipLabeled>
    )
}

export function MoldwrightCreditHint({ credit }: { credit: MoldwrightCredit }) {
    const t = useTranslations('agent.planLimitHint')
    const tShared = useTranslations('agent.modelsShared')
    const locale = useLocale()
    const creditDetail = useMoldwrightCreditDetail()

    if (credit.paused) {
        return (
            <TooltipLabeled label={tShared('creditPaused')} side="right">
                <span className="ml-auto shrink-0 pl-2 font-normal text-muted-foreground">{t('paused')}</span>
            </TooltipLabeled>
        )
    }
    if (credit.budgetMicros <= 0) return null

    return (
        <TooltipLabeled label={creditDetail(credit)} side="right">
            <span className={cn('ml-auto shrink-0 pl-2 font-normal tabular-nums', TONE_CLASS[planLimitTone(credit.percent)])}>
                {credit.percent}%{credit.resetAt ? ` · ${compactUntil(credit.resetAt, locale)}` : ''}
            </span>
        </TooltipLabeled>
    )
}
