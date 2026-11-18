import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticateEngineToken: vi.fn(), embedTextShared: vi.fn() }))

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: mocks.authenticateEngineToken }))
vi.mock('@/lib/services/embed', () => ({ embedTextShared: mocks.embedTextShared }))

const { POST } = await import('./route')

const ask = (body: unknown, authorization: string | null = 'Bearer box-key') =>
    POST(new Request('https://app.rerun.build/api/embed', { method: 'POST', body: JSON.stringify(body), headers: authorization ? { authorization } : {} }))

describe('POST /api/embed', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.authenticateEngineToken.mockResolvedValue({ workspaceId: 7, isSandbox: false })
        mocks.embedTextShared.mockResolvedValue([0.1, 0.2])
    })

    it('answers the embedding the workspace of the engine shares, so a message the hub already asked for is not embedded twice', async () => {
        const response = await ask({ text: 'what did we decide on pricing?' })

        expect(await response.json()).toEqual({ embedding: [0.1, 0.2] })
        expect(mocks.authenticateEngineToken).toHaveBeenCalledWith('box-key')
        expect(mocks.embedTextShared).toHaveBeenCalledWith(7, 'what did we decide on pricing?')
    })

    it.each([
        ['no key', null],
        ['a key no engine holds', 'Bearer forged'],
    ])('refuses %s without embedding anything', async (_label, authorization) => {
        mocks.authenticateEngineToken.mockResolvedValue(null)

        expect((await ask({ text: 'hello' }, authorization)).status).toBe(401)
        expect(mocks.embedTextShared).not.toHaveBeenCalled()
    })

    it('refuses an empty text', async () => {
        expect((await ask({ text: '' })).status).toBe(400)
    })

    it('answers no embedding rather than an error when the provider fails: the memory is still found by keyword', async () => {
        mocks.embedTextShared.mockRejectedValue(new Error('provider away'))

        const response = await ask({ text: 'hello' })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ embedding: null })
    })
})
