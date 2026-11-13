import { AuthorizationError } from '@/app/api/_auth/errors'
import { requireAdminContext, requireWorkspaceId } from '@/app/api/_auth/ownership'
import { NoPlanError } from '@/app/api/_services/capacity.service'
import { ensureWorkspaceEngine, findWorkspaceEngine, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import { providerKeyProblem } from '@/lib/engine/verify-provider-key'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiConnectionAction, updateAiConnectionKeysAction } from './workspace-connection.actions'

vi.mock('@/app/api/_auth/ownership', () => ({ requireAdminContext: vi.fn(), requireWorkspaceId: vi.fn() }))
vi.mock('@/app/api/_services/engine-plan.service', () => ({ assertModelEntitled: vi.fn() }))
vi.mock('@/app/api/_services/capacity.service', () => ({
    NoPlanError: class NoPlanError extends Error {
        constructor() {
            super('This workspace has no active plan.')
        }
    },
}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ ensureWorkspaceEngine: vi.fn(), findWorkspaceEngine: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({
    createConnection: vi.fn(),
    deleteConnection: vi.fn(),
    getConnectionUsage: vi.fn(),
    listConnections: vi.fn(),
    patchConnection: vi.fn(),
    setBoxDefault: vi.fn(),
    updateConnectionKeys: vi.fn(),
}))
vi.mock('@/lib/engine/verify-provider-key', () => ({ providerKeyProblem: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/claude-oauth', () => ({ buildClaudeAuthorize: vi.fn(), exchangeClaudeCode: vi.fn() }))
vi.mock('@/lib/engine/codex-oauth', () => ({ codexKeysFrom: vi.fn(), pollCodexDeviceAuth: vi.fn(), startCodexDeviceAuth: vi.fn() }))
// The open source build has no lifetime plan; the lifetime case reads Rerun Cloud's answer, pinned from ee/.
vi.mock('@rerun/cloud/billing', async importOriginal => ({
    ...(await importOriginal<object>()),
    isLifetimePlan: (await vi.importActual<typeof import('@/ee/lib/billing/plans')>('@/ee/lib/billing/plans')).isLifetimePlan,
}))

const conn = { baseUrl: 'https://engine.test', apiKey: 'box-key' }
const params = { name: 'Anthropic', provider: 'anthropic' as const, models: [], extraModels: [], keys: { ANTHROPIC_API_KEY: 'sk-ant-api03-key' } }
const created = { id: 'cnx', name: 'Anthropic', provider: 'anthropic', models: [], extraModels: [], createdAt: '', connected: true, credentialRejected: false, planLimits: null }

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireWorkspaceId).mockResolvedValue(7)
    vi.mocked(requireAdminContext).mockResolvedValue({ workspace: { id: 7 }, role: 'admin' } as never)
    vi.mocked(providerKeyProblem).mockResolvedValue(null)
    vi.mocked(engine.createConnection).mockResolvedValue(created as never)
})

function workspaceOnPlan(plan: string) {
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase(table => (table === 'workspaces' ? { data: { plan } } : undefined)).client)
}

describe('createAiConnectionAction with the Claude plan', () => {
    const claude = { name: 'Claude', provider: 'claude' as const, models: [], extraModels: [], keys: {} }

    it('refuses it on a lifetime workspace, before reaching the machine', async () => {
        workspaceOnPlan('lifetime')
        await expect(createAiConnectionAction(claude)).resolves.toMatchObject({ success: false, code: 'claudePlanNotOffered' })
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    it('creates it on any other plan', async () => {
        workspaceOnPlan('base')
        vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i', conn, managed: true })
        await expect(createAiConnectionAction(claude)).resolves.toMatchObject({ success: true })
        expect(engine.createConnection).toHaveBeenCalledWith(conn, claude)
    })
})

describe('createAiConnectionAction', () => {
    it('refuses a member who is not an admin, before reaching the machine', async () => {
        vi.mocked(requireAdminContext).mockRejectedValue(new AuthorizationError('adminOnlyAiProviders'))
        await expect(createAiConnectionAction(params)).resolves.toEqual({ success: false, error: 'Only an admin can manage AI providers', code: 'adminOnlyAiProviders' })
        expect(findWorkspaceEngine).not.toHaveBeenCalled()
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    it('creates on the machine the workspace already has', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i', conn, managed: true })
        await expect(createAiConnectionAction(params)).resolves.toEqual({ success: true, connection: created })
        expect(ensureWorkspaceEngine).not.toHaveBeenCalled()
        expect(engine.createConnection).toHaveBeenCalledWith(conn, params)
    })

    it('claims the machine of a workspace on a plan that never needed one yet', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue(null)
        vi.mocked(ensureWorkspaceEngine).mockResolvedValue({ ok: true, instanceId: 'i' })
        vi.mocked(getWorkspaceConnection).mockResolvedValue(conn)
        await expect(createAiConnectionAction(params)).resolves.toMatchObject({ success: true })
        expect(ensureWorkspaceEngine).toHaveBeenCalledWith(7)
        expect(engine.createConnection).toHaveBeenCalledWith(conn, params)
    })

    it('offers the trial to a workspace with no plan, instead of a machine error', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue(null)
        vi.mocked(ensureWorkspaceEngine).mockRejectedValue(new NoPlanError())
        await expect(createAiConnectionAction(params)).resolves.toEqual({ success: false, error: 'Start your free trial to connect your own Claude plan or API key.', code: 'trialToConnectClaude', reason: 'no_plan' })
        expect(engine.createConnection).not.toHaveBeenCalled()
    })

    it('passes on why no machine could be claimed', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue(null)
        vi.mocked(ensureWorkspaceEngine).mockResolvedValue({ ok: false, error: 'No machine is available right now' })
        await expect(createAiConnectionAction(params)).resolves.toEqual({ success: false, error: 'No machine is available right now' })
    })

    it('stores nothing when the provider turns the key down', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i', conn, managed: true })
        vi.mocked(providerKeyProblem).mockResolvedValue({ code: 'providerKeyRejected', params: { provider: 'Anthropic' } })
        await expect(createAiConnectionAction(params)).resolves.toEqual({ success: false, error: 'Anthropic turned this key down. Check it was copied in full and is still active.', code: 'providerKeyRejected', params: { provider: 'Anthropic' } })
        expect(providerKeyProblem).toHaveBeenCalledWith('anthropic', params.keys, undefined)
        expect(engine.createConnection).not.toHaveBeenCalled()
    })
})

describe('updateAiConnectionKeysAction', () => {
    beforeEach(() => {
        vi.mocked(getWorkspaceConnection).mockResolvedValue(conn)
        vi.mocked(engine.listConnections).mockResolvedValue({ connections: [{ ...created, provider: 'openrouter', baseUrl: 'https://router.example.com' }], default: null } as never)
    })

    it('checks the new key against the provider of the connection it replaces', async () => {
        vi.mocked(providerKeyProblem).mockResolvedValue({ code: 'providerKeyRejected', params: { provider: 'OpenRouter' } })
        await expect(updateAiConnectionKeysAction('cnx', { set: { OPENROUTER_API_KEY: 'bad' } })).resolves.toEqual({ success: false, error: 'OpenRouter turned this key down. Check it was copied in full and is still active.', code: 'providerKeyRejected', params: { provider: 'OpenRouter' } })
        expect(providerKeyProblem).toHaveBeenCalledWith('openrouter', { OPENROUTER_API_KEY: 'bad' }, 'https://router.example.com')
        expect(engine.updateConnectionKeys).not.toHaveBeenCalled()
    })

    it('saves an accepted key, and asks nothing for a removal alone', async () => {
        await expect(updateAiConnectionKeysAction('cnx', { set: { OPENROUTER_API_KEY: 'good' } })).resolves.toEqual({ success: true })
        await expect(updateAiConnectionKeysAction('cnx', { remove: ['OPENROUTER_API_KEY'] })).resolves.toEqual({ success: true })
        expect(engine.listConnections).toHaveBeenCalledTimes(1)
        expect(engine.updateConnectionKeys).toHaveBeenCalledTimes(2)
    })
})
