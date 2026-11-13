import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { EngineRequestError, supportsVault } from '@/lib/engine/client'
import { attachVaultItem, deleteVaultItem, deleteVaultToken, detachVaultItem, getVaultItem, getVaultItemUsage, listVaultItems, patchVaultItem } from '@/lib/engine/vault-client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { vaultFlag } from '@/flags'
import { findWorkspaceEngine } from './workspace-engine.service'
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
    signOutVaultEntry,
    vaultEntryUsage,
    vaultWritesEnabled,
    coworkerVault,
} from './vault.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/flags', () => ({ vaultFlag: vi.fn(async () => false) }))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), NoEngineError: class NoEngineError extends Error {} }))
vi.mock('@/lib/engine/client', async importOriginal => ({ EngineRequestError: (await importOriginal<typeof import('@/lib/engine/client')>()).EngineRequestError, supportsVault: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({
    listVaultItems: vi.fn(),
    getVaultItem: vi.fn(),
    attachVaultItem: vi.fn(async () => ({ id: 'item-1' })),
    detachVaultItem: vi.fn(async () => ({ id: 'item-1' })),
    patchVaultItem: vi.fn(async () => ({ id: 'item-1' })),
    deleteVaultItem: vi.fn(),
    deleteVaultToken: vi.fn(),
    getVaultItemUsage: vi.fn(),
}))

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
    vi.mocked(getVaultItem).mockResolvedValue(item() as never)
    vi.mocked(listVaultItems).mockResolvedValue([item(), item({ id: 'item-2', agentIds: ['e-alice', 'e-carol'] }), item({ id: 'item-3', sharedWithAll: true, agentIds: [] })] as never)
    vi.mocked(createServiceRoleClient).mockReturnValue(
        fakeSupabase((table, calls) => {
            if (table === 'agents') {
                const id = filterValue(calls, 'id')
                if (id) {
                    const row = AGENTS.find(agent => agent.id === id)
                    return { data: row ? { workspace_id: WORKSPACE, space_id: row.space_id, engine_agent_id: row.engine_agent_id } : null }
                }
                return { data: AGENTS }
            }
            if (table === 'spaces' && filterValue(calls, 'id')) return { data: SPACES.find(space => space.id === filterValue(calls, 'id')) ?? null }
            if (table === 'spaces') return { data: SPACES }
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

    it('takes new connectors only once released or for the early access, the engine itself following the release', async () => {
        expect(await vaultWritesEnabled(conn, admin)).toBe(false)
        vi.mocked(vaultFlag).mockResolvedValue(true as never)
        expect(await vaultWritesEnabled(conn, admin)).toBe(true)
        expect(await vaultWritesEnabled(conn, workspace)).toBe(false)
        vi.mocked(supportsVault).mockResolvedValue(false)
        expect(await vaultWritesEnabled(conn, admin)).toBe(false)
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

    it('refuses a coworker of a Box the caller only uses, and hides one it cannot see', async () => {
        await expect(attachVaultEntry('item-1', 'bob', managerOfA)).rejects.toMatchObject({ name: 'AccessDeniedError' })
        await expect(attachVaultEntry('item-1', 'carol', managerOfA)).rejects.toMatchObject({ code: 'coworkerNotFound' })
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

    it('never sends a paid app to everyone', async () => {
        vi.mocked(getVaultItem).mockResolvedValue(item({ app: { appSlug: 'linkedin', serverName: 'linkedin' } }) as never)
        await expect(shareVaultEntry('item-1', true, admin)).rejects.toMatchObject({ code: 'vaultPaidAppEveryone' })
    })

    it('lets someone who manages every coworker an entry reaches rename it, and nobody else', async () => {
        await renameVaultEntry('item-1', { label: 'ops@acme.test' }, managerOfA)
        expect(patchVaultItem).toHaveBeenCalledWith(conn, 'item-1', { label: 'ops@acme.test' })
        vi.mocked(getVaultItem).mockResolvedValue(item({ agentIds: ['e-alice', 'e-bob'] }) as never)
        await expect(renameVaultEntry('item-1', { name: 'x' }, managerOfA)).rejects.toMatchObject({ code: 'vaultAdminOnly' })
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

    it('answers an unknown entry as gone when asked who uses it', async () => {
        vi.mocked(getVaultItem).mockRejectedValue(new EngineRequestError('404', 404))
        await expect(vaultEntryUsage('gone', admin)).rejects.toMatchObject({ code: 'vaultItemNotFound' })
    })

    it('lets a manager of a Box sign an entry out and back in, never a member who manages nothing', async () => {
        await signOutVaultEntry('item-1', managerOfA)
        expect(deleteVaultToken).toHaveBeenCalledWith(conn, 'item-1', 'gmail')
        expect(patchVaultItem).toHaveBeenCalledWith(conn, 'item-1', { status: 'needs_auth' })
        await markVaultEntryAuthorized('item-1', managerOfA, { label: 'ops@acme.test' })
        expect(patchVaultItem).toHaveBeenLastCalledWith(conn, 'item-1', { status: 'active', label: 'ops@acme.test' })
        await expect(signOutVaultEntry('item-1', user)).rejects.toMatchObject({ code: 'vaultManageOnly' })
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

    it('says nothing on a box without a Vault, and hides a coworker the caller cannot see', async () => {
        vi.mocked(supportsVault).mockResolvedValue(false)
        expect(await coworkerVault('alice', admin)).toBeNull()
        await expect(coworkerVault('carol', user)).rejects.toMatchObject({ code: 'coworkerNotFound' })
    })
})
