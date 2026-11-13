import { createServiceRoleClient } from '@/supabase/serviceRole'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureCurrentPeriod, hasRemainingBudget, remainingMicros, type WorkspaceBudget } from './rerunBudget.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const eq = vi.fn()
const update = vi.fn((_payload: Record<string, unknown>) => ({ eq }))

function budgetWith(periodAnchor: string | null): WorkspaceBudget {
    return { workspaceId: 42, budgetMicros: 5_000_000, usedMicros: 4_800_000, topupMicros: 0, periodAnchor, currentPeriodEnd: null, paused: false }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: () => ({ update }) } as never)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T10:00:00.000Z'))
})

afterEach(() => {
    vi.useRealTimers()
})

describe('ensureCurrentPeriod', () => {
    it('leaves an anchor younger than a month untouched', async () => {
        const budget = budgetWith('2026-09-01T10:00:00.000Z')

        expect(await ensureCurrentPeriod(budget)).toEqual(budget)
        expect(update).not.toHaveBeenCalled()
    })

    it('refills the credit once the anchor is a month old', async () => {
        const result = await ensureCurrentPeriod(budgetWith('2026-08-01T10:00:00.000Z'))

        expect(update).toHaveBeenCalledWith({ rerun_used_micros: 0, rerun_period_anchor: '2026-09-14T10:00:00.000Z' })
        expect(eq).toHaveBeenCalledWith('id', 42)
        expect(result.usedMicros).toBe(0)
        expect(result.periodAnchor).toBe('2026-09-14T10:00:00.000Z')
    })

    it('adopts a workspace that has no anchor without handing it any credit', async () => {
        const result = await ensureCurrentPeriod(budgetWith(null))

        expect(update).toHaveBeenCalledWith({ rerun_period_anchor: '2026-09-14T10:00:00.000Z' })
        expect(update.mock.calls[0][0]).not.toHaveProperty('rerun_used_micros')
        expect(result.usedMicros).toBe(4_800_000)
        expect(result.periodAnchor).toBe('2026-09-14T10:00:00.000Z')
    })
})

describe('remainingMicros', () => {
    const budget = (over: Partial<WorkspaceBudget>): WorkspaceBudget => ({ ...budgetWith(null), ...over })

    it('counts what is left of the month, then the top-up', () => {
        expect(remainingMicros(budget({ budgetMicros: 5_000_000, usedMicros: 1_000_000, topupMicros: 0 }))).toBe(4_000_000)
    })

    // consume_rerun_credit takes the top-up down as it spends it, so a spent budget must not be
    // counted against it a second time: a signup allowance half spent still has its other half.
    it('does not charge a spent budget against the top-up', () => {
        expect(remainingMicros(budget({ budgetMicros: 0, usedMicros: 100_000, topupMicros: 400_000 }))).toBe(400_000)
        expect(hasRemainingBudget(budget({ budgetMicros: 0, usedMicros: 500_000, topupMicros: 0 }))).toBe(false)
    })
})
