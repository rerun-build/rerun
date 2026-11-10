'use client'

import { TooltipLabeled } from '@/components/ui/tooltip'
import { RERUN_CREDIT_PAUSED_REASON, creditResetPhrase, isCreditUsedUp, planLimitTone, planWindowName, planWindowPercent, planWindowReset, tightestPlanWindow, type PlanLimitTone, type RerunCredit } from '@/lib/engine/ai-sources'
import { shortUntil } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { PlanLimitWindow } from '@rerun/contracts'

const TONE_CLASS: Record<PlanLimitTone, string> = { brand: 'text-muted-foreground', warning: 'text-amber-500', destructive: 'text-destructive' }

// One line per window of a plan, with its reset: what a hover on its usage spells out.
export function PlanLimitDetail({ windows, provider }: { windows: PlanLimitWindow[]; provider?: string }) {
    return (
        <span className="flex flex-col gap-0.5">
            {windows.map(window => {
                const reset = planWindowReset(window)
                return (
                    <span key={`${window.kind}:${window.label ?? ''}`}>
                        {planWindowName(window, provider)}: {planWindowPercent(window)} used{reset ? `, ${reset}` : ''}
                    </span>
                )
            })}
        </span>
    )
}

export function rerunCreditDetail(credit: RerunCredit): string {
    return isCreditUsedUp(credit) ? `Monthly credits used up, back ${creditResetPhrase(credit)}` : `Monthly credits: ${credit.percent}% used, resets ${creditResetPhrase(credit)}`
}

// How far into its plan a subscription is, beside its name in a model picker. One figure for the
// whole group: the limits are the subscription's, every model under it draws on the same ones.
export function PlanLimitHint({ windows, provider }: { windows: PlanLimitWindow[]; provider?: string }) {
    const tightest = tightestPlanWindow(windows)
    if (!tightest) return null

    return (
        <TooltipLabeled label={<PlanLimitDetail windows={windows} provider={provider} />} side="right">
            <span className={cn('ml-auto shrink-0 pl-2 font-normal tabular-nums', TONE_CLASS[planLimitTone(tightest.usedPercent)])}>
                {planWindowPercent(tightest)}
                {tightest.resetsAt ? ` · ${shortUntil(tightest.resetsAt).replace(/^in /, '')}` : ''}
            </span>
        </TooltipLabeled>
    )
}

// The same figure for the Rerun group, whose usage is the workspace's monthly credit rather than a
// plan's rate windows.
export function RerunCreditHint({ credit }: { credit: RerunCredit }) {
    if (credit.paused) {
        return (
            <TooltipLabeled label={RERUN_CREDIT_PAUSED_REASON} side="right">
                <span className="ml-auto shrink-0 pl-2 font-normal text-muted-foreground">Paused</span>
            </TooltipLabeled>
        )
    }
    if (credit.budgetMicros <= 0) return null

    return (
        <TooltipLabeled label={rerunCreditDetail(credit)} side="right">
            <span className={cn('ml-auto shrink-0 pl-2 font-normal tabular-nums', TONE_CLASS[planLimitTone(credit.percent)])}>
                {credit.percent}%{credit.resetAt ? ` · ${shortUntil(credit.resetAt).replace(/^in /, '')}` : ''}
            </span>
        </TooltipLabeled>
    )
}
