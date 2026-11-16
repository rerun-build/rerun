import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { attachVaultEntry, detachVaultEntry, listVault } from '@/app/api/_services/vault.service'
import { dispatchForemanVaultTool, vaultAccountsToLend } from './vault-tools'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_services/vault.service', () => ({
    listVault: vi.fn(),
    attachVaultEntry: vi.fn(async () => ({})),
    detachVaultEntry: vi.fn(async () => ({})),
    VaultUnavailableError: class VaultUnavailableError extends Error {},
}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ NoEngineError: class NoEngineError extends Error {} }))

const member: Actor = { kind: 'user', userId: 'member-1', workspaceId: 7, role: 'member', boxScope: 'all' }

const gmail = {
    id: 'item-1',
    kind: 'service',
    slug: 'gmail',
    name: 'Gmail',
    label: 'ada@acme.test',
    status: 'needs_auth',
    config: { region: 'eu' },
    mcpServers: [{ name: 'gmail', url: 'https://mcp.test' }],
    skills: [],
    composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_secret', userId: 'composio-user' },
    agentIds: ['e-alice', 'e-carol'],
    sharedWithAll: false,
    createdBy: 'admin-1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    envKeys: ['GMAIL_TOKEN'],
    tokens: ['gmail'],
    coworkers: [{ id: 'alice', engineAgentId: 'e-alice', name: 'Alice', spaceId: 'box-a' }],
    hiddenCoworkers: 1,
    canChange: false,
}

describe('list_vault', () => {
    beforeEach(() => vi.mocked(listVault).mockReset())

    it('reads the Vault as the member the turn speaks for', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [], coworkers: [], canAdd: true, isAdmin: false })
        await dispatchForemanVaultTool(member, 'list_vault', {})
        expect(listVault).toHaveBeenCalledWith(member)
    })

    it('names each account, its state and who holds it, and counts the coworkers the member cannot see', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [gmail] as never, coworkers: [], canAdd: true, isAdmin: false })
        const out = (await dispatchForemanVaultTool(member, 'list_vault', {})) as { available: boolean; entries: unknown[]; youAreAdmin: boolean }
        expect(out).toEqual({
            available: true,
            youAreAdmin: false,
            entries: [{ id: 'item-1', name: 'Gmail', kind: 'service', slug: 'gmail', account: 'ada@acme.test', status: 'needs_auth', sharedWithAll: false, coworkers: [{ id: 'alice', name: 'Alice' }], hiddenCoworkers: 1 }],
        })
    })

    it('never hands the model variable names, token servers, Composio ids, settings or who added the entry', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [gmail] as never, coworkers: [], canAdd: true, isAdmin: true })
        const text = JSON.stringify(await dispatchForemanVaultTool(member, 'list_vault', {}))
        for (const leak of ['GMAIL_TOKEN', 'ca_secret', 'composio-user', 'admin-1', 'e-alice', 'e-carol', 'mcp.test', 'region']) expect(text).not.toContain(leak)
    })

    it('marks a paid app, which cannot be shared with everyone', async () => {
        vi.mocked(listVault).mockResolvedValue({ entries: [{ ...gmail, app: { appSlug: 'linkedin-pro', serverName: 'linkedin' }, hiddenCoworkers: 0 }] as never, coworkers: [], canAdd: true, isAdmin: true })
        const out = (await dispatchForemanVaultTool(member, 'list_vault', {})) as { entries: Array<Record<string, unknown>> }
        expect(out.entries[0].paid).toBe(true)
        expect(out.entries[0]).not.toHaveProperty('hiddenCoworkers')
    })

    it('says the box keeps no Vault rather than failing, on a box without one or without a machine', async () => {
        const { VaultUnavailableError } = await import('@/app/api/_services/vault.service')
        const { NoEngineError } = await import('@/app/api/_services/workspace-engine.service')
        for (const err of [new VaultUnavailableError(), new NoEngineError()]) {
            vi.mocked(listVault).mockRejectedValueOnce(err)
            expect(await dispatchForemanVaultTool(member, 'list_vault', {})).toMatchObject({ available: false })
        }
    })

    it('lets any other failure through', async () => {
        vi.mocked(listVault).mockRejectedValueOnce(new Error('engine down'))
        await expect(dispatchForemanVaultTool(member, 'list_vault', {})).rejects.toThrow('engine down')
    })
})

const ALICE = { id: 'alice', engineAgentId: 'e-alice', name: 'Alice', spaceId: 'box-a', canManage: true }
const BOB = { id: 'bob', engineAgentId: 'e-bob', name: 'Bob', spaceId: 'box-a', canManage: true }

function vaultWith(...entries: Array<Partial<typeof gmail>>) {
    vi.mocked(listVault).mockResolvedValue({ entries: entries.map(entry => ({ ...gmail, hiddenCoworkers: 0, ...entry })) as never, coworkers: [ALICE, BOB], canAdd: true, isAdmin: false })
}

describe('set_vault_link', () => {
    beforeEach(() => vi.clearAllMocks())

    it('lends an account to a coworker as the member the turn speaks for', async () => {
        vaultWith({ coworkers: [ALICE] })
        const out = await dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: true })
        expect(attachVaultEntry).toHaveBeenCalledWith('item-1', 'bob', member)
        expect(out).toMatchObject({ changed: true, attached: true, account: 'Gmail (ada@acme.test)', coworker: { id: 'bob', name: 'Bob' } })
    })

    it('takes it back, the account staying in the Vault', async () => {
        vaultWith({ coworkers: [ALICE, BOB] })
        const out = await dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: 'false' })
        expect(detachVaultEntry).toHaveBeenCalledWith('item-1', 'bob', member)
        expect(out).toMatchObject({ changed: true, attached: false })
    })

    it('writes nothing when the coworker already is where it was asked to be', async () => {
        vaultWith({ coworkers: [ALICE] })
        expect(await dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'alice', attached: true })).toMatchObject({ changed: false })
        expect(await dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: false })).toMatchObject({ changed: false })
        expect(attachVaultEntry).not.toHaveBeenCalled()
        expect(detachVaultEntry).not.toHaveBeenCalled()
    })

    // Taking it back from one coworker would leave it with every other one: that is the panel's.
    it('sends an entry shared with every coworker to the Vault panel', async () => {
        vaultWith({ sharedWithAll: true, coworkers: [] })
        const out = (await dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: false })) as { changed: boolean; message: string }
        expect(out.changed).toBe(false)
        expect(out.message).toContain('Vault panel')
        expect(detachVaultEntry).not.toHaveBeenCalled()
    })

    it('refuses an entry or a coworker it cannot find, with the way to the right id', async () => {
        vaultWith({})
        await expect(dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'nope', agentId: 'bob', attached: true })).rejects.toThrow('list_vault')
        await expect(dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'carol', attached: true })).rejects.toThrow('board map')
        await expect(dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: 'yes' })).rejects.toThrow('attached')
    })

    // The permission matrix of the Vault stays the service's: a member who does not manage the Box
    // of the coworker is refused there.
    it('lets the refusal of the Vault reach the model as a sentence', async () => {
        vaultWith({ coworkers: [ALICE] })
        vi.mocked(attachVaultEntry).mockRejectedValueOnce(new Error('Only a manager of this Box can do that.'))
        await expect(dispatchForemanVaultTool(member, 'set_vault_link', { itemId: 'item-1', agentId: 'bob', attached: true })).rejects.toThrow('Only a manager')
    })
})

describe('attach_connector, seen from the Vault', () => {
    beforeEach(() => vi.clearAllMocks())

    // It may be another member's account: lending it is a question, never a side effect.
    it('lends nothing on its own and names the accounts the Vault already holds', async () => {
        vaultWith({ id: 'item-1', label: 'ada@acme.test', coworkers: [ALICE] }, { id: 'item-2', label: 'sales@acme.test', coworkers: [] })
        const out = (await vaultAccountsToLend(member, { agentId: 'bob', slug: 'gmail' })) as { declared: boolean; vault: Array<{ itemId: string; account: string }>; message: string }
        expect(out.declared).toBe(false)
        expect(out.vault.map(entry => [entry.itemId, entry.account])).toEqual([
            ['item-1', 'ada@acme.test'],
            ['item-2', 'sales@acme.test'],
        ])
        expect(out.message).toContain('set_vault_link')
        expect(attachVaultEntry).not.toHaveBeenCalled()
    })

    it('lets the declaration through when the user wants another account', async () => {
        vaultWith({ coworkers: [] })
        expect(await vaultAccountsToLend(member, { agentId: 'bob', slug: 'gmail', newAccount: true })).toBeNull()
        expect(listVault).not.toHaveBeenCalled()
    })

    it('lets it through when the Vault holds no account of the app', async () => {
        vaultWith({ slug: 'notion', name: 'Notion', coworkers: [] })
        expect(await vaultAccountsToLend(member, { agentId: 'bob', slug: 'gmail' })).toBeNull()
    })

    // Declared again, the app would land in the coworker's own folder beside the account it draws on.
    it('declares nothing for a coworker that already uses an account of the app from the Vault', async () => {
        vaultWith({ coworkers: [BOB] }, { id: 'item-2', coworkers: [] })
        expect(await vaultAccountsToLend(member, { agentId: 'bob', slug: 'gmail' })).toMatchObject({ declared: false, itemId: 'item-1' })
        vaultWith({ sharedWithAll: true, coworkers: [], status: 'needs_auth' })
        const shared = (await vaultAccountsToLend(member, { agentId: 'bob', slug: 'gmail' })) as { message: string }
        expect(shared.message).toContain('shared with every coworker')
        expect(shared.message).toContain('waits on someone')
    })

    it('lets it through on a box without a Vault', async () => {
        const { VaultUnavailableError } = await import('@/app/api/_services/vault.service')
        vi.mocked(listVault).mockRejectedValueOnce(new VaultUnavailableError())
        expect(await vaultAccountsToLend(member, { agentId: 'bob', slug: 'gmail' })).toBeNull()
    })
})
