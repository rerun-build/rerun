import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureCurrentPeriod, getWorkspaceBudgetByEngineKey } from '@/ee/services/rerunBudget.service'
import { POST } from './route'

vi.mock('@/ee/services/rerunBudget.service', () => ({
    ensureCurrentPeriod: vi.fn(),
    getWorkspaceBudgetByEngineKey: vi.fn(),
    RERUN_CREDIT_PAUSED_ERROR: 'rerun_credit_paused',
    remainingMicros: (budget: { budgetMicros: number; usedMicros: number; topupMicros: number }) => Math.max(budget.budgetMicros - budget.usedMicros, 0) + budget.topupMicros,
}))

type Budget = Awaited<ReturnType<typeof getWorkspaceBudgetByEngineKey>>

const originalMultiplier = process.env.PAID_DATA_PRICE_MULTIPLIER

const SPENT_LAST_MONTH = { workspaceId: 7, budgetMicros: 5_000_000, usedMicros: 5_000_000, topupMicros: 0 } as unknown as NonNullable<Budget>

function estimateRequest({ token = 'engine-key', body = { calls: [{ capability: 'people.email.find', count: 30 }] } }: { token?: string | null; body?: unknown } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token !== null) headers.authorization = `Bearer ${token}`
    return new Request('https://hub.test/api/paid-data/estimate', { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('POST /api/paid-data/estimate', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env.PAID_DATA_PRICE_MULTIPLIER
        vi.mocked(getWorkspaceBudgetByEngineKey).mockImplementation(async token => (token === 'engine-key' ? SPENT_LAST_MONTH : null))
        vi.mocked(ensureCurrentPeriod).mockImplementation(async budget => ({ ...budget, usedMicros: 0 }))
    })

    afterEach(() => {
        if (originalMultiplier === undefined) delete process.env.PAID_DATA_PRICE_MULTIPLIER
        else process.env.PAID_DATA_PRICE_MULTIPLIER = originalMultiplier
    })

    it('refuses a request without an engine key, or with one that names no workspace', async () => {
        expect((await POST(estimateRequest({ token: null }))).status).toBe(401)
        expect((await POST(estimateRequest({ token: 'stolen' }))).status).toBe(401)
    })

    it('refuses a batch its schema rejects', async () => {
        expect((await POST(estimateRequest({ body: { calls: [] } }))).status).toBe(400)
        expect((await POST(estimateRequest({ body: { calls: [{ capability: 'treg.anything', count: 1 }] } }))).status).toBe(400)
        expect(ensureCurrentPeriod).not.toHaveBeenCalled()
    })

    it('refuses to price a spend while the credit is paused, so no card goes out', async () => {
        vi.mocked(getWorkspaceBudgetByEngineKey).mockResolvedValue({ ...SPENT_LAST_MONTH, paused: true })

        const response = await POST(estimateRequest())

        expect(response.status).toBe(402)
        expect(await response.json()).toEqual({ error: 'rerun_credit_paused' })
        expect(ensureCurrentPeriod).not.toHaveBeenCalled()
    })

    it('prices the batch at the default multiplier and reports the credit left once the period is current', async () => {
        const response = await POST(estimateRequest())

        expect(response.status).toBe(200)
        expect(ensureCurrentPeriod).toHaveBeenCalledWith(SPENT_LAST_MONTH)
        expect(await response.json()).toEqual({ totalMicros: 900_000, lines: [{ capability: 'people.email.find', count: 30, units: 30, micros: 900_000 }], remainingMicros: 5_000_000 })
    })

    it('prices at the multiplier the hub bills with', async () => {
        process.env.PAID_DATA_PRICE_MULTIPLIER = '1.5'

        expect((await (await POST(estimateRequest())).json()).totalMicros).toBe(1_350_000)
    })

    it('counts the rows of a capability billed per row', async () => {
        const response = await POST(estimateRequest({ body: { calls: [{ capability: 'companies.search', count: 2, limit: 25 }] } }))

        expect((await response.json()).lines).toEqual([{ capability: 'companies.search', count: 2, units: 50, micros: 500_000 }])
    })
})
