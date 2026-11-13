import { beforeEach, describe, expect, it, vi } from 'vitest'

import { decompileService } from '@/lib/services/compiler'
import { type RegistryEntry, readOwnRegistry, removeRegistryEntry } from '@/lib/services/registry'
import { decompileMigrationCopy, dropMigrationCopy } from './copies'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/services/compiler', () => ({ decompileService: vi.fn() }))
vi.mock('@/lib/services/registry', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/services/registry')>()),
    readOwnRegistry: vi.fn(),
    readRegistry: vi.fn(async () => ({ services: {} })),
    removeRegistryEntry: vi.fn(),
}))

const conn = { baseUrl: 'https://engine.test', apiKey: null }
const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({ status: 'active', config: {}, mcpServers: ['gmail'], envKeys: ['GMAIL_KEY'], skills: [], installedAt: '2026-10-01', ...over })
const gmail = (connectedAccountId?: string) => ({ toolkit: 'gmail', serverName: 'gmail', ...(connectedAccountId ? { connectedAccountId } : {}) })
const own = (copy: RegistryEntry) => vi.mocked(readOwnRegistry).mockResolvedValue({ services: { gmail: copy } })

beforeEach(() => vi.clearAllMocks())

describe("what a coworker holds under an entry's key, once the entry leaves it", () => {
    it('goes with the entry when it is the copy the migration left', async () => {
        own(entry())
        await dropMigrationCopy(conn, 'e-alice', 'gmail', {})
        expect(decompileService).toHaveBeenCalledWith(conn, 'e-alice', entry(), expect.anything())
        expect(removeRegistryEntry).toHaveBeenCalledWith(conn, 'e-alice', 'gmail')
    })

    it('goes without revoking the Composio account the entry kept', async () => {
        own(entry({ composio: gmail('ca-1') }))
        expect(await decompileMigrationCopy(conn, 'e-alice', 'gmail', { composio: gmail('ca-1') })).toBe(true)
        expect(vi.mocked(decompileService).mock.calls[0][2].composio).toEqual({ toolkit: 'gmail', serverName: 'gmail', connectedAccountId: undefined })
    })

    it.each([
        ['a Composio account of its own', entry({ composio: gmail('ca-own') }), { composio: gmail('ca-1') }],
        ['a Composio account, under an entry that holds none', entry({ composio: gmail('ca-own') }), {}],
        ['a Composio sign-in it never finished', entry({ status: 'needs_auth', composio: gmail() }), { composio: gmail() }],
        ['a paid app', entry({ app: { appSlug: 'linkedin', serverName: 'linkedin' } }), {}],
    ])('stays when it is %s', async (_what, copy, item) => {
        own(copy)
        await dropMigrationCopy(conn, 'e-alice', 'gmail', item)
        expect(decompileService).not.toHaveBeenCalled()
        expect(removeRegistryEntry).not.toHaveBeenCalled()
    })

    it('is nothing to take for a coworker that holds none', async () => {
        vi.mocked(readOwnRegistry).mockResolvedValue({ services: {} })
        expect(await decompileMigrationCopy(conn, 'e-alice', 'gmail', {})).toBe(false)
        expect(decompileService).not.toHaveBeenCalled()
    })
})
