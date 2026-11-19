import { beforeEach, describe, expect, it, vi } from 'vitest'

const foremanEngineFilesAction = vi.fn()

vi.mock('@/app/api/_actions/foreman-file.actions', () => ({ foremanEngineFilesAction: () => foremanEngineFilesAction() }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, supabase: {} }),
}))

const { GET } = await import('./route')

const segment = { params: Promise.resolve({}) }
const request = () => new Request('https://moldwright.robagentic.tech/api/v1/foreman/files')

describe('GET /api/v1/foreman/files', () => {
    beforeEach(() => foremanEngineFilesAction.mockReset())

    it('says the foreman takes files when its engine does', async () => {
        foremanEngineFilesAction.mockResolvedValue(true)
        expect(await (await GET(request(), segment)).json()).toEqual({ supported: true })
    })

    it('says it does not on a box that predates foreman files', async () => {
        foremanEngineFilesAction.mockResolvedValue(false)
        expect(await (await GET(request(), segment)).json()).toEqual({ supported: false })
    })
})
