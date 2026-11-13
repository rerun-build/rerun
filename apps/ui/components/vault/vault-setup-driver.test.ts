import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addVaultServiceAction, markVaultEntryAuthorizedAction, reconfigureVaultServiceAction } from '@/app/api/_actions/vault.actions'
import { vaultSetupDriver } from './vault-setup-driver'

vi.mock('@/app/api/_actions/vault.actions', () => ({ addVaultServiceAction: vi.fn(), reconfigureVaultServiceAction: vi.fn(), markVaultEntryAuthorizedAction: vi.fn() }))

const item = { id: 'item-1', slug: 'linear', mcpServers: [{ name: 'linear' }] }

beforeEach(() => vi.clearAllMocks())

describe('vaultSetupDriver', () => {
    it('adds an entry on the first submit, then configures that same entry, answering its id as the key', async () => {
        vi.mocked(addVaultServiceAction).mockResolvedValue({ ok: true, result: { status: 'needs_auth', item, oauth: { serverName: 'linear', url: 'https://mcp.linear.test' } } } as never)
        vi.mocked(reconfigureVaultServiceAction).mockResolvedValue({ ok: true, result: { status: 'installed', item } } as never)
        const onItem = vi.fn()
        const driver = vaultSetupDriver({ itemId: null, agentIds: ['alice'], onItem }, 'Linear')

        const first = await driver.install('', 'linear', { REGION: 'eu' }, 'oauth')
        expect(addVaultServiceAction).toHaveBeenCalledWith({ slug: 'linear', values: { REGION: 'eu' }, authMethodId: 'oauth', agentIds: ['alice'] })
        expect(first).toEqual({ ok: true, result: { status: 'needs_auth', key: 'item-1', slug: 'linear', name: 'Linear', oauth: { serverName: 'linear', url: 'https://mcp.linear.test' }, message: '' } })
        expect(onItem).toHaveBeenCalledWith('item-1')

        const second = await driver.install('', 'item-1', { TOKEN: 't' }, 'key')
        expect(reconfigureVaultServiceAction).toHaveBeenCalledWith('item-1', { TOKEN: 't' }, 'key')
        expect(second).toMatchObject({ ok: true, result: { status: 'installed', key: 'item-1', toolNames: ['linear'] } })
    })

    it('hands a refusal back as it came', async () => {
        vi.mocked(addVaultServiceAction).mockResolvedValue({ ok: false, error: 'Only an admin can do this', code: 'vaultAdminOnly' })
        expect(await vaultSetupDriver({ itemId: null, agentIds: [], onItem: vi.fn() }, 'Linear').install('', 'linear', {}, undefined)).toEqual({ ok: false, error: 'Only an admin can do this', code: 'vaultAdminOnly' })
    })

    it('flips the entry it signed in', async () => {
        vi.mocked(markVaultEntryAuthorizedAction).mockResolvedValue({ ok: true, result: item } as never)
        expect(await vaultSetupDriver({ itemId: 'item-1', agentIds: [], onItem: vi.fn() }, 'Linear').markAuthorized('', 'item-1')).toEqual({ success: true })
        expect(markVaultEntryAuthorizedAction).toHaveBeenCalledWith('item-1')
    })
})
