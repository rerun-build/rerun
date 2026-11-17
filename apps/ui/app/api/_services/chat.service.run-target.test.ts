import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireWorkspaceContext: vi.fn(), findWorkspaceEngine: vi.fn() }))

vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()), requireWorkspaceContext: mocks.requireWorkspaceContext }))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: mocks.findWorkspaceEngine, NoEngineError: class NoEngineError extends Error {} }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const { resolveRunTarget } = await import('./chat.service')
const { AuthorizationError } = await import('@/app/api/_auth/ownership')

const conn = { baseUrl: 'http://engine', apiKey: 'k' }
const contextOf = (role: 'admin' | 'member', anonymous = false) => ({ role, workspace: { id: 7 }, authUser: { is_anonymous: anonymous } })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.findWorkspaceEngine.mockResolvedValue({ conn })
})

// The alias older apps send for the Chief of Staff holds the rule its row holds.
describe('resolveRunTarget on the alias foreman', () => {
    it('lets every member use it', async () => {
        mocks.requireWorkspaceContext.mockResolvedValue(contextOf('member'))
        await expect(resolveRunTarget('foreman')).resolves.toEqual({ conn, engineAgentId: 'foreman' })
    })

    it('lets only an admin manage it', async () => {
        mocks.requireWorkspaceContext.mockResolvedValue(contextOf('member'))
        await expect(resolveRunTarget('foreman', 'manage')).rejects.toBeInstanceOf(AuthorizationError)
        mocks.requireWorkspaceContext.mockResolvedValue(contextOf('admin'))
        await expect(resolveRunTarget('foreman', 'manage')).resolves.toEqual({ conn, engineAgentId: 'foreman' })
    })

    it('turns a visitor without an account away', async () => {
        mocks.requireWorkspaceContext.mockResolvedValue(contextOf('admin', true))
        await expect(resolveRunTarget('foreman')).rejects.toBeInstanceOf(AuthorizationError)
    })
})
