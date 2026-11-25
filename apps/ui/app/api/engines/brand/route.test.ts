import { RERUN_BRAND } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn() }))
vi.mock('@/lib/brand/workspace', () => ({ workspaceBrand: vi.fn() }))

const { authenticateEngineToken } = await import('@/app/api/_services/workspace-engine.service')
const { workspaceBrand } = await import('@/lib/brand/workspace')
const { GET } = await import('./route')

const ask = (token?: string) => GET(new Request('https://app.example/api/engines/brand', { headers: token ? { authorization: `Bearer ${token}` } : {} }))

describe('GET /api/engines/brand', () => {
    beforeEach(() => {
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === 'box-key' ? { workspaceId: 7, isSandbox: false } : null))
        vi.mocked(workspaceBrand).mockResolvedValue(RERUN_BRAND)
    })

    it('refuses a key of no machine', async () => {
        expect((await ask()).status).toBe(401)
        expect((await ask('other')).status).toBe(401)
        expect(workspaceBrand).not.toHaveBeenCalled()
    })

    it('answers Rerun', async () => {
        expect(await (await ask('box-key')).json()).toEqual({ name: 'Rerun', whiteLabel: false, supportEmail: null })
    })

    it('answers the organization of the workspace, and nothing more of it', async () => {
        vi.mocked(workspaceBrand).mockResolvedValue({ ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', supportEmail: 'help@nordlys.example', color: '#123456' })
        expect(await (await ask('box-key')).json()).toEqual({ name: 'Nordlys', whiteLabel: true, supportEmail: 'help@nordlys.example' })
        expect(workspaceBrand).toHaveBeenCalledWith(7)
    })
})
