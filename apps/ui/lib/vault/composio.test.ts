import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getVaultItem } from '@/lib/engine/vault-client'
import { readRegistry } from '@/lib/services/registry'
import { composioUserForKey, composioVaultUserId } from './composio'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn() }))

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const entry = { status: 'active' as const, config: {}, mcpServers: [], envKeys: [], skills: [], installedAt: '' }

beforeEach(() => vi.clearAllMocks())

describe('the Composio user of a connector', () => {
    it("is the entry's own for an account the Vault lends, or the one it was connected with", async () => {
        expect(composioVaultUserId({ id: 'item-1' })).toBe('local_vault_item-1')
        expect(composioVaultUserId({ id: 'item-1', composio: { toolkit: 'gmail', serverName: 'gmail', userId: 'local_agent_a1' } })).toBe('local_agent_a1')
        vi.mocked(readRegistry).mockResolvedValue({ services: { gmail: { ...entry, vaultItemId: 'item-1' } } })
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1' } as never)
        expect(await composioUserForKey(conn, 'e-1', 'agent-1', 'gmail')).toBe('local_vault_item-1')
    })

    it("is the coworker's own, per account, otherwise", async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: {} })
        expect(await composioUserForKey(conn, 'e-1', 'agent-1', 'gmail')).toBe('local_agent_agent-1')
        expect(await composioUserForKey(conn, 'e-1', 'agent-1', 'gmail@k3x9ab')).toBe('local_agent_agent-1_k3x9ab')
        expect(getVaultItem).not.toHaveBeenCalled()
    })
})
