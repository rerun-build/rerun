import { beforeEach, describe, expect, it, vi } from 'vitest'

const getStoreOffer = vi.fn()
const workspace = { id: 7 }
const context = { userId: 'user-1', authUser: { id: 'user-1' }, workspace, role: 'member', supabase: {} }

vi.mock('@/ee/services/store-billing.service', () => ({ getStoreOffer: (...args: unknown[]) => getStoreOffer(...args) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => context,
}))

const { GET } = await import('./route')

const segment = { params: Promise.resolve({}) }
const request = (client?: string) => new Request('https://app.rerun.build/api/v1/billing/store', { headers: client ? { 'x-rerun-client': client } : {} })

describe('GET /api/v1/billing/store', () => {
    beforeEach(() => {
        getStoreOffer.mockReset().mockResolvedValue({ available: false, reason: 'member' })
    })

    it.each([
        [undefined, 'apple'],
        ['ios/1.2.0 (40)', 'apple'],
        ['android/1.0.1 (4)', 'google'],
    ])('asks for the store of the app that calls (%s)', async (client, provider) => {
        expect(await (await GET(request(client), segment)).json()).toEqual({ available: false, reason: 'member' })
        expect(getStoreOffer).toHaveBeenCalledWith(context, provider)
    })
})
