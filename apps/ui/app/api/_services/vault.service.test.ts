import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { EngineRequestError, supportsForemanCoworker, supportsVault, supportsVaultInstance, supportsVaultRename } from '@/lib/engine/client'
import { attachVaultItem, deleteVaultItem, detachVaultItem, getVaultItem, getVaultItemUsage, instanceVaultItem, listVaultItems, patchVaultItem } from '@/lib/engine/vault-client'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { findWorkspaceEngine } from './workspace-engine.service'
import { revokeVaultComposioAccount } from '@/lib/vault/composio'
import { dropMigrationCopy } from '@/lib/vault/copies'
import { loadManifest } from './services.service'
import {
    VaultConflictError,
    VaultUnavailableError,
    attachVaultEntry,
    canChangeItem,
    deleteVaultEntry,
    detachVaultEntry,
    listVault,
    markVaultEntryAuthorized,
    renameVaultEntry,
    shareVaultEntry,
    vaultEntryUsage,
    coworkerVault,
} from './vault.service'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/vault/copies', () => ({ dropMigrationCopy: vi.fn(async () => {}) }))
vi.mock('@/lib/vault/composio', () => ({ revokeVaultComposioAccount: vi.fn(async () => {}) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), NoEngineError: class NoEngineError extends Error {} }))
vi.mock('@/lib/engine/client', async importOriginal => ({ EngineRequestError: (await importOriginal<typeof import('@/lib/engine/client')>()).EngineRequestError, supportsVault: vi.fn(), supportsVaultRename: vi.fn(), supportsVaultInstance: vi.fn(), supportsForemanCoworker: vi.fn(async () => false) }))
vi.mock('@/lib/engine/vault-client', () => ({
    listVaultItems: vi.fn(),
    getVaultItem: vi.fn(),
    attachVaultItem: vi.fn(async () => ({ id: 'item-1' })),
    detachVaultItem: vi.fn(async () => ({ id: 'item-1' })),
    patchVaultItem: vi.fn(async () => ({ id: 'item-1' })),
    deleteVaultItem: vi.fn(),
    getVaultItemUsage: vi.fn(),
    instanceVaultItem: vi.fn(),
}))
vi.mock('./services.service', () => ({ loadManifest: vi.fn() }))

const WORKSPACE = 7
const conn = { baseUrl: 'https://engine.test', apiKey: null }
const admin: Actor = { kind: 'user', userId: 'admin-1', workspaceId: WORKSPACE, role: 'admin', boxScope: 'all' }
// Manages Box A, uses Box B through the workspace-wide scope.
const managerOfA: Actor = { kind: 'user', userId: 'manager-a', workspaceId: WORKSPACE, role: 'member', boxScope: 'all' }
// Reaches Box B only through a `use` grant, manages nothing.
const user: Actor = { kind: 'user', userId: 'user-1', workspaceId: WORKSPACE, role: 'member', boxScope: 'none' as never }
const workspace: Actor = { kind: 'workspace', workspaceId: WORKSPACE }

const AGENTS = [
    { id: 'alice', engine_agent_id: 'e-alice', name: 'Alice', space_id: 'box-a' },
    { id: 'bob', engine_agent_id: 'e-bob', name: 'Bob', space_id: 'box-b' },
    { id: 'carol', engine_agent_id: 'e-carol', name: 'Carol', space_id: 'box-private' },
    { id: 'draft', engine_agent_id: null, name: 'Draft', space_id: 'box-a' },
]
const SPACES = [
    { id: 'box-a', workspace_id: WORKSPACE, visibility: 'workspace' },
    { id: 'box-b', workspace_id: WORKSPACE, visibility: 'workspace' },
    { id: 'box-private', workspace_id: WORKSPACE, visibility: 'restricted' },
]
const GRANTS: Record<string, Array<{ space_id: string; access: string }>> = {
    'manager-a': [{ space_id: 'box-a', access: 'manage' }],
    'user-1': [{ space_id: 'box-b', access: 'use' }],
}

function filterValue(calls: readonly { method: string; args: unknown[] }[], column: string): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === column)?.args[1]
}

const item = (over: Record<string, unknown> = {}) => ({
    id: 'item-1',
    kind: 'service',
    slug: 'gmail',
    name: 'Gmail',
    status: 'active',
    config: {},
    mcpServers: [],
    skills: [],
    agentIds: ['e-alice'],
    sharedWithAll: false,
    createdBy: null,
    createdAt: '',
    updatedAt: '',
    envKeys: [],
    tokens: ['gmail'],
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i', conn, managed: true })
    vi.mocked(supportsVault).mockResolvedValue(true)
    vi.mocked(supportsVaultRename).mockResolvedValue(true)
    vi.mocked(supportsVaultInstance).mockResolvedValue(true)
    vi.mocked(supportsForemanCoworker).mockResolvedValue(false)
    vi.mocked(getVaultItem).mockResolvedValue(item() as never)
    vi.mocked(listVaultItems).mockResolvedValue([item(), item({ id: 'item-2', agentIds: ['e-alice', 'e-carol'] }), item({ id: 'item-3', sharedWithAll: true, agentIds: [] })] as never)
    vi.mocked(createServiceRoleClient).mockReturnValue(
        fakeSupabase((table, calls) => {
            if (table === 'agents') {
                const id = filterValue(calls, 'id')
                if (filterValue(calls, 'kind') === 'foreman') return { data: { id: 'cos-1' } }
                if (id === 'cos-1') return { data: { id: 'cos-1', workspace_id: WORKSPACE, kind: 'foreman', space_id: null, engine_agent_id: 'foreman' } }
                if (id) {
                    const row = AGENTS.find(agent => agent.id === id)
                    return { data: row ? { workspace_id: WORKSPACE, space_id: row.space_id, engine_agent_id: row.engine_agent_id } : null }
                }
                return { data: AGENTS }
            }
            if (table === 'spaces' && filterValue(calls, 'id')) return { data: SPACES.find(space => space.id === filterValue(calls, 'id')) ?? null }
            if (table === 'spaces') return { data: SPACES }
            if (table === 'services') return { data: [{ slug: 'linear', name: 'Linear' }] }
            if (table === 'space_members') {
                const userId = filterValue(calls, 'user_id') as string
                const spaceId = filterValue(calls, 'space_id') as string | undefined
                const grants = GRANTS[userId] ?? []
                return spaceId ? { data: grants.find(g => g.space_id === spaceId) ?? null } : { data: grants }
            }
            return undefined
        }).client,
    )
})

describe('the Vault of a box', () => {
    it('is out of reach on a box whose engine keeps none', async () => {
        vi.mocked(supportsVault).mockResolvedValue(false)
        await expect(listVault(admin)).rejects.toBeInstanceOf(VaultUnavailableError)
    })
})

describe('listing', () => {
    it('shows every entry to any member, naming only the coworkers they can see', async () => {
        const listing = await listVault(user)
        expect(listing.entries.map(e => e.id)).toEqual(['item-1', 'item-2', 'item-3'])
        expect(listing.entries[1].coworkers).toEqual([])
        expect(listing.entries[1].hiddenCoworkers).toBe(2)
        expect(listing.coworkers.map(c => [c.id, c.canManage])).toEqual([['bob', false]])
        expect(listing.canAdd).toBe(false)
        expect(listing.isAdmin).toBe(false)
    })

    it('lets a manager of one Box add, and attach to the coworkers of that Box only', async () => {
        const listing = await listVault(managerOfA)
        expect(listing.canAdd).toBe(true)
        expect(listing.coworkers.map(c => [c.id, c.canManage])).toEqual([
            ['alice', true],
            ['bob', false],
        ])
        expect(listing.entries.map(e => e.canChange)).toEqual([true, false, false])
    })

    it('gives an admin every coworker and every right', async () => {
        const listing = await listVault(admin)
        expect(listing.coworkers.map(c => c.id)).toEqual(['alice', 'bob', 'carol'])
        expect(listing.entries.every(e => e.canChange)).toBe(true)
        expect(listing.isAdmin).toBe(true)
    })
})

describe('attaching', () => {
    it('attaches a coworker of a Box the caller manages', async () => {
        await attachVaultEntry('item-1', 'alice', managerOfA)
        expect(attachVaultItem).toHaveBeenCalledWith(conn, 'item-1', 'e-alice')
    })

    // The Chief of Staff's own tools (call_agent, its coworker databases) name coworkers by their engine id.
    it('attaches a coworker named by the id the engine knows it by', async () => {
        await attachVaultEntry('item-1', 'e-alice', managerOfA)
        expect(attachVaultItem).toHaveBeenCalledWith(conn, 'item-1', 'e-alice')
    })

    it('names the coworker it cannot find', async () => {
        const refusal = await attachVaultEntry('item-1', 'ghost', admin).catch(err => err)
        expect(refusal).toMatchObject({ code: 'vaultCoworkerNotFound', params: { id: 'ghost' }, message: 'Coworker not found: ghost' })
        expect(attachVaultItem).not.toHaveBeenCalled()
    })

    it('refuses a coworker of a Box the caller only uses, and hides one it cannot see', async () => {
        await expect(attachVaultEntry('item-1', 'bob', managerOfA)).rejects.toMatchObject({ name: 'AccessDeniedError' })
        await expect(attachVaultEntry('item-1', 'carol', managerOfA)).rejects.toMatchObject({ code: 'vaultCoworkerNotFound', params: { id: 'carol' } })
        await expect(attachVaultEntry('item-1', 'e-carol', managerOfA)).rejects.toMatchObject({ code: 'vaultCoworkerNotFound', params: { id: 'e-carol' } })
        await expect(detachVaultEntry('item-1', 'bob', user)).rejects.toMatchObject({ name: 'AccessDeniedError' })
        expect(attachVaultItem).not.toHaveBeenCalled()
        expect(detachVaultItem).not.toHaveBeenCalled()
    })

    it('names the coworker and the variable when the engine refuses a clash', async () => {
        vi.mocked(attachVaultItem).mockRejectedValue(new EngineRequestError(`rerun-engine PUT /vault/item-1/agents/e-alice failed: 409 ${JSON.stringify({ error: 'x', conflicts: [{ agentId: 'e-alice', itemId: 'item-2', kind: 'env', name: 'API_TOKEN' }] })}`, 409))
        const refusal = await attachVaultEntry('item-1', 'alice', admin).catch(err => err)
        expect(refusal).toBeInstanceOf(VaultConflictError)
        expect(refusal.params).toEqual({ name: 'API_TOKEN', coworker: 'Alice' })
        expect(refusal.conflicts).toHaveLength(1)
    })

    it('refuses an entry the engine no longer has', async () => {
        vi.mocked(getVaultItem).mockRejectedValue(new EngineRequestError('404', 404))
        await expect(attachVaultEntry('gone', 'alice', admin)).rejects.toMatchObject({ code: 'vaultItemNotFound' })
    })

    describe("an account lent over the coworker's own install still waiting on its sign-in", () => {
        const pending = [
            item({ id: 'never-signed-in', status: 'needs_auth', tokens: [], agentIds: ['e-alice'] }),
            item({ id: 'signed-out', status: 'needs_auth', tokens: ['gmail'], agentIds: ['e-alice'] }),
            item({ id: 'shared-pending', status: 'needs_auth', tokens: [], agentIds: ['e-alice', 'e-bob'] }),
            item({ id: 'second-account', status: 'needs_auth', tokens: [], instanceId: 'x2', agentIds: ['e-alice'] }),
            item({ id: 'other-app', slug: 'slack', status: 'needs_auth', tokens: [], agentIds: ['e-alice'] }),
        ]

        beforeEach(() => {
            vi.mocked(getVaultItem).mockResolvedValue(item({ id: 'lent', agentIds: [] }) as never)
            vi.mocked(listVaultItems).mockResolvedValue([item({ id: 'lent', agentIds: [] }), ...pending] as never)
            vi.mocked(detachVaultItem).mockImplementation(async (_conn, id, agentId) => {
                const twin = pending.find(other => other.id === id)!
                return { ...twin, agentIds: twin.agentIds.filter(other => other !== agentId) } as never
            })
            vi.mocked(attachVaultItem).mockReset().mockResolvedValue(item({ id: 'lent' }) as never)
        })

        afterEach(() => {
            vi.mocked(detachVaultItem).mockReset().mockResolvedValue({ id: 'item-1' } as never)
        })

        it('takes the install off the coworker first, so the engine sees no clash and the copy cannot take the account along', async () => {
            await attachVaultEntry('lent', 'alice', managerOfA)

            expect(vi.mocked(detachVaultItem).mock.calls.map(call => call[1])).toEqual(['never-signed-in', 'signed-out', 'shared-pending'])
            expect(dropMigrationCopy).toHaveBeenCalledTimes(3)
            const lentAt = vi.mocked(attachVaultItem).mock.invocationCallOrder[0]
            expect(Math.max(...vi.mocked(detachVaultItem).mock.invocationCallOrder, ...vi.mocked(dropMigrationCopy).mock.invocationCallOrder)).toBeLessThan(lentAt)
            expect(attachVaultItem).toHaveBeenCalledWith(conn, 'lent', 'e-alice')
        })

        it('deletes only an install nobody else holds and nobody ever signed in to', async () => {
            await attachVaultEntry('lent', 'alice', managerOfA)

            expect(deleteVaultItem).toHaveBeenCalledTimes(1)
            expect(deleteVaultItem).toHaveBeenCalledWith(conn, 'never-signed-in')
            expect(revokeVaultComposioAccount).not.toHaveBeenCalled()
        })

        it('puts the installs back when the engine refuses the account', async () => {
            vi.mocked(attachVaultItem)
                .mockRejectedValueOnce(new EngineRequestError(`rerun-engine PUT /vault/lent/agents/e-alice failed: 409 ${JSON.stringify({ error: 'x', conflicts: [{ agentId: 'e-alice', itemId: 'item-9', kind: 'env', name: 'GMAIL_KEY' }] })}`, 409))
                .mockResolvedValue(item() as never)

            await expect(attachVaultEntry('lent', 'alice', managerOfA)).rejects.toBeInstanceOf(VaultConflictError)

            expect(vi.mocked(attachVaultItem).mock.calls.slice(1).map(call => call[1])).toEqual(['never-signed-in', 'signed-out', 'shared-pending'])
            expect(deleteVaultItem).not.toHaveBeenCalled()
        })
    })

    describe('an account added before its app took several accounts', () => {
        const GETXAPI = serviceManifestSchema.parse({
            slug: 'getxapi',
            name: 'GetXAPI',
            inputs: [{ key: 'GETXAPI_KEY', label: 'GetXAPI API key', type: 'password', secret: true, required: true }],
            mcpServers: [{ name: 'getxapi', transport: 'stdio', command: 'npx', args: ['-y', '@getxapi/mcp@latest'], env: { GETXAPI_KEY: '${input.GETXAPI_KEY}' } }],
        })
        const legacy = (id: string, over: Record<string, unknown> = {}) =>
            item({ id, slug: 'getxapi', name: 'GetXAPI', tokens: [], envKeys: ['RERUN_SVC_GETXAPI_GETXAPI_KEY'], mcpServers: [{ name: 'getxapi', args: [], env: {}, headers: {} }], ...over })
        const clash = (with_: string, kind = 'env', name = 'RERUN_SVC_GETXAPI_GETXAPI_KEY') =>
            new EngineRequestError(`rerun-engine PUT /vault/second/agents/e-alice failed: 409 ${JSON.stringify({ error: 'x', conflicts: [{ agentId: 'e-alice', itemId: with_, kind, name }] })}`, 409)

        beforeEach(() => {
            vi.mocked(loadManifest).mockResolvedValue(GETXAPI)
            vi.mocked(getVaultItem).mockResolvedValue(legacy('second', { agentIds: ['e-bob'], customLabel: 'Compte X de Rerun' }) as never)
            vi.mocked(listVaultItems).mockResolvedValue([legacy('first', { agentIds: ['e-alice'] }), legacy('second', { agentIds: ['e-bob'] }), legacy('third', { agentIds: [], instanceId: 'zz11zz', label: 'GetXAPI 2' })] as never)
            vi.mocked(attachVaultItem).mockReset().mockRejectedValueOnce(clash('first')).mockResolvedValue(legacy('second') as never)
            vi.mocked(instanceVaultItem).mockImplementation(async (_conn, id, input) => legacy(id, { instanceId: input.instanceId }) as never)
            vi.mocked(getVaultItemUsage).mockResolvedValue(['e-bob'])
        })

        it('gets an instance of its own, then joins the coworker holding the first account', async () => {
            await attachVaultEntry('second', 'alice', admin)

            const [, id, input] = vi.mocked(instanceVaultItem).mock.calls[0]
            const instanceId = input.instanceId
            expect(id).toBe('second')
            expect(instanceId).toMatch(/^[a-z0-9]{6}$/)
            expect(instanceId).not.toBe('zz11zz')
            expect(input).toEqual({
                instanceId,
                label: 'GetXAPI 3',
                servers: { getxapi: `getxapi-${instanceId}` },
                env: { RERUN_SVC_GETXAPI_GETXAPI_KEY: `RERUN_SVC_GETXAPI_${instanceId.toUpperCase()}_GETXAPI_KEY` },
            })
            expect(dropMigrationCopy).toHaveBeenCalledWith(conn, 'e-bob', 'getxapi', expect.objectContaining({ id: 'second' }))
            expect(vi.mocked(attachVaultItem).mock.calls.map(call => call[1])).toEqual(['second', 'second'])
        })

        it('keeps the label its sign-in wrote', async () => {
            vi.mocked(getVaultItem).mockResolvedValue(legacy('second', { label: 'theo@example.com' }) as never)
            await attachVaultEntry('second', 'alice', managerOfA)
            expect(vi.mocked(instanceVaultItem).mock.calls[0][2]).not.toHaveProperty('label')
        })

        it('still refuses a clash with another app, a paid app, an app with nothing to connect and a box that cannot rename', async () => {
            const refused = async () => {
                vi.mocked(attachVaultItem).mockReset().mockRejectedValueOnce(clash('first')).mockResolvedValue(legacy('second') as never)
                await expect(attachVaultEntry('second', 'alice', managerOfA)).rejects.toBeInstanceOf(VaultConflictError)
            }
            vi.mocked(listVaultItems).mockResolvedValue([legacy('first', { slug: 'twitter' }), legacy('second')] as never)
            await refused()
            vi.mocked(listVaultItems).mockResolvedValue([legacy('first'), legacy('second')] as never)

            vi.mocked(getVaultItem).mockResolvedValue(legacy('second', { app: { appSlug: 'linkedin-pro', serverName: 'getxapi' } }) as never)
            await refused()
            vi.mocked(getVaultItem).mockResolvedValue(legacy('second') as never)

            vi.mocked(loadManifest).mockResolvedValue(serviceManifestSchema.parse({ ...GETXAPI, authMethods: [], inputs: [] }))
            await refused()
            vi.mocked(loadManifest).mockResolvedValue(GETXAPI)

            vi.mocked(supportsVaultInstance).mockResolvedValue(false)
            await refused()

            expect(instanceVaultItem).not.toHaveBeenCalled()
        })

        it('rewrites the skill that quotes its variables before the rename, and puts it back when the box refuses', async () => {
            const usage = { slug: 'getxapi-usage', name: 'getxapi-usage', description: 'How', body: 'curl $GETXAPI_KEY' }
            vi.mocked(loadManifest).mockResolvedValue(serviceManifestSchema.parse({ ...GETXAPI, authMethods: [], envKeys: [{ key: 'GETXAPI_KEY', fromInput: 'GETXAPI_KEY' }], skills: [usage] }))
            vi.mocked(getVaultItem).mockResolvedValue(legacy('second', { envKeys: ['GETXAPI_KEY'], skills: [usage] }) as never)

            await attachVaultEntry('second', 'alice', admin)

            const { instanceId } = vi.mocked(instanceVaultItem).mock.calls[0][2]
            expect(patchVaultItem).toHaveBeenCalledExactlyOnceWith(conn, 'second', { skills: [expect.objectContaining({ slug: `getxapi-usage-${instanceId}`, body: `curl $GETXAPI_KEY_${instanceId.toUpperCase()}`, description: expect.stringContaining('"GetXAPI 3"') })] })
            expect(vi.mocked(patchVaultItem).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(instanceVaultItem).mock.invocationCallOrder[0])

            vi.mocked(patchVaultItem).mockClear()
            vi.mocked(attachVaultItem).mockReset().mockRejectedValueOnce(clash('first'))
            vi.mocked(instanceVaultItem).mockRejectedValueOnce(new Error('engine unreachable'))
            await expect(attachVaultEntry('second', 'alice', admin)).rejects.toThrow('engine unreachable')
            expect(patchVaultItem).toHaveBeenLastCalledWith(conn, 'second', { skills: [usage] })
        })

        it('leaves an account that already has an instance as it is', async () => {
            vi.mocked(getVaultItem).mockResolvedValue(legacy('second', { instanceId: 'ab12cd' }) as never)
            await expect(attachVaultEntry('second', 'alice', managerOfA)).rejects.toBeInstanceOf(VaultConflictError)
            expect(instanceVaultItem).not.toHaveBeenCalled()
        })

        it('is renamed only by who may change it: an admin, the box, or whoever manages every coworker holding it', async () => {
            await expect(attachVaultEntry('second', 'alice', managerOfA)).rejects.toBeInstanceOf(VaultConflictError)
            expect(instanceVaultItem).not.toHaveBeenCalled()

            vi.mocked(attachVaultItem).mockReset().mockRejectedValueOnce(clash('first')).mockResolvedValue(legacy('second') as never)
            await attachVaultEntry('second', 'alice', workspace)
            expect(instanceVaultItem).toHaveBeenCalledTimes(1)

            vi.mocked(getVaultItem).mockResolvedValue(legacy('second', { agentIds: [] }) as never)
            vi.mocked(attachVaultItem).mockReset().mockRejectedValueOnce(clash('first')).mockResolvedValue(legacy('second') as never)
            await attachVaultEntry('second', 'alice', managerOfA)
            expect(instanceVaultItem).toHaveBeenCalledTimes(2)
        })

        it('finishes a rename the box was stopped in, with the same instance, then joins', async () => {
            const halfRenamed = legacy('second', {
                agentIds: ['e-bob'],
                instanceId: 'ab12cd',
                envKeys: ['RERUN_SVC_GETXAPI_AB12CD_GETXAPI_KEY', 'RERUN_SVC_GETXAPI_GETXAPI_KEY'],
                tokens: ['getxapi', 'getxapi-ab12cd'],
                mcpServers: [{ name: 'getxapi-ab12cd', args: [], env: {}, headers: {} }],
            })
            vi.mocked(getVaultItem).mockResolvedValue(halfRenamed as never)

            await attachVaultEntry('second', 'alice', admin)

            expect(instanceVaultItem).toHaveBeenCalledWith(conn, 'second', {
                instanceId: 'ab12cd',
                servers: { getxapi: 'getxapi-ab12cd' },
                env: { RERUN_SVC_GETXAPI_GETXAPI_KEY: 'RERUN_SVC_GETXAPI_AB12CD_GETXAPI_KEY' },
            })
            expect(dropMigrationCopy).toHaveBeenCalledWith(conn, 'e-bob', 'getxapi', expect.objectContaining({ id: 'second' }))
            expect(vi.mocked(attachVaultItem).mock.calls.map(call => call[1])).toEqual(['second', 'second'])
        })

        it('still joins when a copy left by the migration cannot be dropped', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            vi.mocked(dropMigrationCopy).mockRejectedValueOnce(new Error('engine unreachable'))
            await expect(attachVaultEntry('second', 'alice', admin)).resolves.toMatchObject({ id: 'second' })
            expect(warn).toHaveBeenCalledWith('[vault] copy of e-bob left in place:', 'engine unreachable')
            warn.mockRestore()
        })
    })

    it('leaves the pending installs alone when the account lent is not signed in either', async () => {
        vi.mocked(attachVaultItem).mockResolvedValue(item({ id: 'lent' }) as never)
        vi.mocked(getVaultItem).mockResolvedValue(item({ id: 'lent', status: 'needs_auth' }) as never)
        await attachVaultEntry('lent', 'alice', admin)
        expect(listVaultItems).not.toHaveBeenCalledWith(conn, 'e-alice')
        expect(deleteVaultItem).not.toHaveBeenCalled()
    })
})

describe('the foreman in the Vault', () => {
    beforeEach(() => {
        vi.mocked(supportsForemanCoworker).mockResolvedValue(true)
        vi.mocked(attachVaultItem).mockReset().mockResolvedValue(item({ agentIds: ['foreman'] }) as never)
    })

    it('is listed first for an admin, who may attach to it', async () => {
        const listing = await listVault(admin)
        expect(listing.coworkers.map(c => [c.id, c.name, c.canManage])[0]).toEqual(['foreman', 'Chief of Staff', true])
        await attachVaultEntry('item-1', 'foreman', admin)
        expect(attachVaultItem).toHaveBeenCalledWith(conn, 'item-1', 'foreman')
    })

    it('sits in no Box, so nobody but an admin sees it or attaches to it', async () => {
        expect((await listVault(managerOfA)).coworkers.map(c => c.id)).not.toContain('foreman')
        await expect(attachVaultEntry('item-1', 'foreman', managerOfA)).rejects.toMatchObject({ code: 'vaultCoworkerNotFound', params: { id: 'foreman' } })
        expect(attachVaultItem).not.toHaveBeenCalled()
    })

    it('is counted, not named, on an entry it holds for a member who cannot see it', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([item({ agentIds: ['foreman'] })] as never)
        const [entry] = (await listVault(user)).entries
        expect(entry.coworkers).toEqual([])
        expect(entry.hiddenCoworkers).toBe(1)
    })

    it('is not there on a box whose foreman keeps nothing of its own', async () => {
        vi.mocked(supportsForemanCoworker).mockResolvedValue(false)
        expect((await listVault(admin)).coworkers.map(c => c.id)).toEqual(['alice', 'bob', 'carol'])
        await expect(attachVaultEntry('item-1', 'foreman', admin)).rejects.toMatchObject({ code: 'vaultCoworkerNotFound', params: { id: 'foreman' } })
    })
})

describe('admin-only changes', () => {
    it('shares with everyone, deletes, for an admin only', async () => {
        await expect(shareVaultEntry('item-1', true, managerOfA)).rejects.toMatchObject({ code: 'vaultAdminOnly' })
        await expect(deleteVaultEntry('item-1', managerOfA)).rejects.toMatchObject({ code: 'vaultAdminOnly' })
        expect(patchVaultItem).not.toHaveBeenCalled()
        expect(deleteVaultItem).not.toHaveBeenCalled()

        vi.mocked(deleteVaultItem).mockResolvedValue({ deleted: 'item-1', detached: ['e-alice', 'e-gone'] })
        expect(await deleteVaultEntry('item-1', admin)).toEqual({ detached: [{ id: 'alice', engineAgentId: 'e-alice', name: 'Alice', spaceId: 'box-a' }] })
        await shareVaultEntry('item-1', true, admin)
        expect(patchVaultItem).toHaveBeenCalledWith(conn, 'item-1', { sharedWithAll: true })
    })

    it('revokes the Composio account of an entry it deletes, and deletes it even when Composio does not answer', async () => {
        const connected = item({ composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca-1' } })
        vi.mocked(getVaultItem).mockResolvedValue(connected as never)
        vi.mocked(deleteVaultItem).mockResolvedValue({ deleted: 'item-1', detached: [] })
        await deleteVaultEntry('item-1', admin)
        expect(revokeVaultComposioAccount).toHaveBeenCalledWith(WORKSPACE, connected)

        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(revokeVaultComposioAccount).mockRejectedValueOnce(new Error('Composio is down'))
        expect(await deleteVaultEntry('item-1', admin)).toEqual({ detached: [] })
        expect(deleteVaultItem).toHaveBeenCalledTimes(2)
    })

    it('never sends a paid app to everyone', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(item({ app: { appSlug: 'linkedin', serverName: 'linkedin' } }) as never)
        await expect(shareVaultEntry('item-1', true, admin)).rejects.toMatchObject({ code: 'vaultPaidAppEveryone' })
    })

})

describe('who may change an item', () => {
    const ctx = { byEngineId: new Map(AGENTS.filter(a => a.engine_agent_id).map(a => [a.engine_agent_id as string, { id: a.id, engineAgentId: a.engine_agent_id as string, name: a.name, spaceId: a.space_id }])) }

    it('lets the engine change only an item the calling coworker alone holds', async () => {
        expect(await canChangeItem(workspace, item({ agentIds: ['e-alice'] }) as never, ctx, 'e-alice')).toBe(true)
        expect(await canChangeItem(workspace, item({ agentIds: ['e-alice', 'e-bob'] }) as never, ctx, 'e-alice')).toBe(false)
        expect(await canChangeItem(workspace, item({ sharedWithAll: true, agentIds: [] }) as never, ctx, 'e-alice')).toBe(false)
    })

    it('keeps an item shared with everyone for admins', async () => {
        expect(await canChangeItem(managerOfA, item({ sharedWithAll: true, agentIds: [] }) as never, ctx)).toBe(false)
        expect(await canChangeItem(admin, item({ sharedWithAll: true, agentIds: [] }) as never, ctx)).toBe(true)
    })
})

describe('renaming an account', () => {
    it('writes the name apart from the label, trimmed, and gives the default back on an empty one', async () => {
        await renameVaultEntry('item-1', '  Personal  ', managerOfA)
        expect(patchVaultItem).toHaveBeenLastCalledWith(conn, 'item-1', { customLabel: 'Personal' })
        await renameVaultEntry('item-1', '   ', managerOfA)
        expect(patchVaultItem).toHaveBeenLastCalledWith(conn, 'item-1', { customLabel: null })
        await renameVaultEntry('item-1', null, managerOfA)
        expect(patchVaultItem).toHaveBeenLastCalledWith(conn, 'item-1', { customLabel: null })
    })

    it('follows who may change the item: an account shared with everyone is renamed by an admin only', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(item({ sharedWithAll: true, agentIds: [] }) as never)
        await expect(renameVaultEntry('item-1', 'Personal', managerOfA)).rejects.toMatchObject({ code: 'vaultAdminOnly' })
        await renameVaultEntry('item-1', 'Personal', admin)
        expect(patchVaultItem).toHaveBeenCalledTimes(1)
    })

    it('refuses on a box that would drop the name, and never renames a secret', async () => {
        vi.mocked(supportsVaultRename).mockResolvedValue(false)
        await expect(renameVaultEntry('item-1', 'Personal', admin)).rejects.toMatchObject({ code: 'vaultRenameUnsupported' })
        vi.mocked(supportsVaultRename).mockResolvedValue(true)
        vi.mocked(getVaultItem).mockResolvedValue(item({ kind: 'secret', slug: null }) as never)
        await expect(renameVaultEntry('item-1', 'Personal', admin)).rejects.toThrow()
        expect(patchVaultItem).not.toHaveBeenCalled()
    })

    it('tells the screen whether the box can rename', async () => {
        expect((await listVault(admin)).canRename).toBe(true)
        vi.mocked(supportsVaultRename).mockResolvedValue(false)
        expect((await listVault(admin)).canRename).toBe(false)
    })
})

describe('an entry no coworker holds yet', () => {
    const ctx = { byEngineId: new Map() }
    const orphan = item({ agentIds: [] }) as never

    it('is changed by whoever may add to the Vault, never by a member who manages nothing, nor by the engine', async () => {
        expect(await canChangeItem(managerOfA, orphan, ctx)).toBe(true)
        expect(await canChangeItem(user, orphan, ctx)).toBe(false)
        expect(await canChangeItem(workspace, orphan, ctx, 'e-alice')).toBe(false)
    })
})

describe('conflicts the hub cannot name', () => {
    it('says every coworker for two entries shared with everyone, and a coworker for one it does not know', async () => {
        const conflict = (agentId: string) => new EngineRequestError(`409 ${JSON.stringify({ error: 'x', conflicts: [{ agentId, itemId: 'i', kind: 'env', name: 'K' }] })}`, 409)
        vi.mocked(attachVaultItem).mockRejectedValueOnce(conflict('*'))
        await expect(attachVaultEntry('item-1', 'alice', admin)).rejects.toMatchObject({ code: 'vaultConflictEveryone', params: { name: 'K' } })
        vi.mocked(attachVaultItem).mockRejectedValueOnce(conflict('e-ghost'))
        await expect(attachVaultEntry('item-1', 'alice', admin)).rejects.toMatchObject({ code: 'vaultConflictSomeone', params: { name: 'K' } })
    })
})

describe('sign-in', () => {
    it('leaves an entry signed out when its sign-in wrote no token', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(item({ tokens: [], oauth: { serverName: 'gmail', url: 'https://g.test' } }) as never)
        await markVaultEntryAuthorized('item-1', admin)
        expect(patchVaultItem).not.toHaveBeenCalled()
    })

    it('never turns a Composio or managed entry active on a say-so', async () => {
        for (const target of [{ composio: { toolkit: 'gmail', serverName: 'gmail' } }, { managed: { provider: 'typeform', serverName: 'typeform' } }]) {
            vi.mocked(getVaultItem).mockResolvedValueOnce(item({ status: 'needs_auth', tokens: [], ...target }) as never)
            await markVaultEntryAuthorized('item-1', admin)
        }
        expect(patchVaultItem).not.toHaveBeenCalled()
    })

    it('answers an unknown entry as gone when asked who uses it', async () => {
        vi.mocked(getVaultItem).mockRejectedValue(new EngineRequestError('404', 404))
        await expect(vaultEntryUsage('gone', admin)).rejects.toMatchObject({ code: 'vaultItemNotFound' })
    })

    it('lets a manager of a Box record a sign-in, never a member who manages nothing', async () => {
        await markVaultEntryAuthorized('item-1', managerOfA, { label: 'ops@acme.test' })
        expect(patchVaultItem).toHaveBeenLastCalledWith(conn, 'item-1', { status: 'active', label: 'ops@acme.test' })
        await expect(markVaultEntryAuthorized('item-1', user)).rejects.toMatchObject({ code: 'vaultManageOnly' })
    })

    it('names who would lose an entry, counting those the caller cannot see', async () => {
        vi.mocked(getVaultItemUsage).mockResolvedValue(['e-alice', 'e-carol'])
        expect(await vaultEntryUsage('item-1', managerOfA)).toEqual({ coworkers: [{ id: 'alice', engineAgentId: 'e-alice', name: 'Alice', spaceId: 'box-a' }], hidden: 1 })
    })
})

describe("a coworker's side of the Vault", () => {
    it('lists its custom servers and secrets, and what it could be given, saying whether the caller may', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([
            item({ id: 'app', kind: 'service', agentIds: ['e-alice'] }),
            item({ id: 'secret', kind: 'secret', slug: null, agentIds: ['e-alice'] }),
            item({ id: 'everyone', kind: 'mcp', slug: null, sharedWithAll: true, agentIds: [] }),
            item({ id: 'other', kind: 'secret', slug: null, agentIds: ['e-bob'] }),
        ] as never)
        const forManager = await coworkerVault('alice', managerOfA)
        expect(forManager?.attached.map(i => i.id)).toEqual(['secret', 'everyone'])
        expect(forManager?.available.map(i => i.id)).toEqual(['other'])
        expect(forManager?.canAttach).toBe(true)
        expect((await coworkerVault('bob', managerOfA))?.canAttach).toBe(false)
    })

    it("shows the Chief of Staff's side to every member, and lets only an admin attach to it", async () => {
        vi.mocked(listVaultItems).mockResolvedValue([item({ id: 'mine', kind: 'secret', slug: null, agentIds: ['foreman'] }), item({ id: 'other', kind: 'secret', slug: null, agentIds: ['e-bob'] })] as never)
        const forAdmin = await coworkerVault('foreman', admin)
        expect(forAdmin?.attached.map(i => i.id)).toEqual(['mine'])
        expect(forAdmin?.available.map(i => i.id)).toEqual(['other'])
        expect(forAdmin?.canAttach).toBe(true)
        expect((await coworkerVault('foreman', managerOfA))?.canAttach).toBe(false)
    })

    it('says nothing on a box without a Vault, and hides a coworker the caller cannot see', async () => {
        vi.mocked(supportsVault).mockResolvedValue(false)
        expect(await coworkerVault('alice', admin)).toBeNull()
        await expect(coworkerVault('carol', user)).rejects.toMatchObject({ code: 'coworkerNotFound' })
    })
})

describe('an app the box moved into the Vault on its own', () => {
    it('shows under its catalog name, never its slug', async () => {
        vi.mocked(listVaultItems).mockResolvedValue([item({ slug: 'linear', name: 'linear' }), item({ id: 'item-2', slug: 'linear', name: 'Team Linear' })] as never)
        expect((await listVault(admin)).entries.map(entry => entry.name)).toEqual(['Linear', 'Team Linear'])
    })

    it('takes the copy left in a coworker folder with it, on a detach and on a delete', async () => {
        await detachVaultEntry('item-1', 'alice', admin)
        expect(dropMigrationCopy).toHaveBeenCalledWith(conn, 'e-alice', 'gmail', expect.objectContaining({ id: 'item-1' }))

        vi.mocked(dropMigrationCopy).mockClear()
        vi.mocked(deleteVaultItem).mockResolvedValue({ deleted: 'item-1', detached: ['e-alice', 'e-carol'] } as never)
        await deleteVaultEntry('item-1', admin)
        expect(vi.mocked(dropMigrationCopy).mock.calls.map(call => call[1])).toEqual(['e-alice', 'e-carol'])
    })

    it('leaves the copy of a coworker that still gets the entry through everyone', async () => {
        vi.mocked(detachVaultItem).mockResolvedValue({ id: 'item-1', sharedWithAll: true } as never)
        await detachVaultEntry('item-1', 'alice', admin)
        expect(dropMigrationCopy).not.toHaveBeenCalled()
    })
})
