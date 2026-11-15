import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { GET } from './route'

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn() }))

const WORKSPACE_ID = 7
const originalMultiplier = process.env.PAID_DATA_PRICE_MULTIPLIER

describe('GET /api/paid-data', () => {
    const priceRequest = (token: string | null) => new Request('https://hub.test/api/paid-data', { headers: token === null ? {} : { authorization: `Bearer ${token}` } })

    beforeEach(() => {
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === 'engine-key' ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
    })

    afterEach(() => {
        if (originalMultiplier === undefined) delete process.env.PAID_DATA_PRICE_MULTIPLIER
        else process.env.PAID_DATA_PRICE_MULTIPLIER = originalMultiplier
    })

    it('refuses a request without an engine key, or with one that names no workspace', async () => {
        expect((await GET(priceRequest(null))).status).toBe(401)
        expect((await GET(priceRequest('stolen'))).status).toBe(401)
    })

    it.each([
        [undefined, 1],
        ['1.5', 1.5],
        ['not a number', 1],
    ])('tells the engine this hub sells no paid data, with a multiplier it accepts (env %s)', async (env, expected) => {
        if (env === undefined) delete process.env.PAID_DATA_PRICE_MULTIPLIER
        else process.env.PAID_DATA_PRICE_MULTIPLIER = env

        const response = await GET(priceRequest('engine-key'))

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ enabled: false, priceMultiplier: expected })
    })
})
