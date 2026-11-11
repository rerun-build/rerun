import { BILLING_ENABLED, rerunCreditTotalMicros } from '@rerun/cloud/billing'
import type { HubRerunCredit } from '@rerun/contracts'
import { ensureCurrentPeriod, getWorkspaceBudget, remainingMicros } from '@/ee/services/rerunBudget.service'

export function isAiStatusHubTool(name: string): name is 'rerun_credit' {
    return name === 'rerun_credit'
}

// A self-hosted install sells no credit, so it has none to report.
export async function readRerunCredit(workspaceId: number): Promise<{ credit: HubRerunCredit | null }> {
    if (!BILLING_ENABLED) return { credit: null }
    const stored = await getWorkspaceBudget(workspaceId)
    if (!stored) return { credit: null }
    const budget = await ensureCurrentPeriod(stored)
    return {
        credit: {
            remainingMicros: remainingMicros(budget),
            usedMicros: budget.usedMicros,
            totalMicros: rerunCreditTotalMicros({ rerun_budget_micros: budget.budgetMicros, rerun_used_micros: budget.usedMicros, rerun_topup_micros: budget.topupMicros }),
            paused: budget.paused,
            resetsAt: budget.currentPeriodEnd,
        },
    }
}
