import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureCurrentPeriod, getWorkspaceBudget } from '@/ee/services/rerunBudget.service'

const billing = vi.hoisted(() => ({ enabled: true }))

vi.mock('@rerun/cloud/billing', () => ({
    get BILLING_ENABLED() {
        return billing.enabled
    },
    rerunCreditTotalMicros: (w: { rerun_budget_micros: number; rerun_used_micros: number; rerun_topup_micros: number }) => Math.max(w.rerun_budget_micros, w.rerun_used_micros) + w.rerun_topup_micros,
}))
vi.mock('@/ee/services/rerunBudget.service', async importOriginal => ({
    remainingMicros: (await importOriginal<typeof import('@/ee/services/rerunBudget.service')>()).remainingMicros,
    getWorkspaceBudget: vi.fn(),
    ensureCurrentPeriod: vi.fn(async (budget: unknown) => budget),
}))

const { isAiStatusHubTool, readRerunCredit } = await import('./ai-status-hub.service')

const BUDGET = { workspaceId: 7, budgetMicros: 20_000_000, usedMicros: 5_000_000, topupMicros: 1_000_000, periodAnchor: '2026-11-01T00:00:00Z', currentPeriodEnd: '2026-12-01T00:00:00Z', paused: false }

describe('readRerunCredit', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        billing.enabled = true
        vi.mocked(getWorkspaceBudget).mockResolvedValue(BUDGET)
    })

    it('knows only rerun_credit', () => {
        expect(isAiStatusHubTool('rerun_credit')).toBe(true)
        for (const name of ['team_status', 'service_install', 'toString']) expect(isAiStatusHubTool(name)).toBe(false)
    })

    it('reads what is left of the month and the top-up, after the lazy monthly reset', async () => {
        expect(await readRerunCredit(7)).toEqual({ credit: { remainingMicros: 16_000_000, usedMicros: 5_000_000, totalMicros: 21_000_000, paused: false, resetsAt: '2026-12-01T00:00:00Z' } })
        expect(getWorkspaceBudget).toHaveBeenCalledWith(7)
        expect(ensureCurrentPeriod).toHaveBeenCalledWith(BUDGET)
    })

    it('has no credit to report on a build that sells none', async () => {
        billing.enabled = false
        expect(await readRerunCredit(7)).toEqual({ credit: null })
        expect(getWorkspaceBudget).not.toHaveBeenCalled()
    })
})
