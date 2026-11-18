import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, writeMethodOf, type FakeSupabase, type SupabaseResult } from '@/test/supabase-fake'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ attachCustomEngine: vi.fn(), findWorkspaceEngine: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ getEngineHealth: vi.fn(), listConnections: vi.fn() }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { attachCustomEngine, findWorkspaceEngine } = await import('@/app/api/_services/workspace-engine.service')
const { getEngineHealth, listConnections } = await import('@/lib/engine/client')
const { createPairingToken, detachWorkspaceServer, engineAddress, redeemPairingToken } = await import('./servers.service')

const TOKEN = 'rrn_pair_abc'
const KEY = 'k'.repeat(64)
const URL = 'http://10.0.0.5:3000'

let db: FakeSupabase
let tokenRow: Record<string, unknown> | null
let spend: SupabaseResult

beforeEach(() => {
    vi.clearAllMocks()
    tokenRow = { id: 't1', workspace_id: 7, expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: null }
    spend = { data: [{ id: 't1' }] }
    db = fakeSupabase((table, calls) => {
        if (table !== 'engine_pairing_tokens') return undefined
        if (writeMethodOf(calls) === 'update') return spend
        if (writeMethodOf(calls)) return undefined
        return { data: tokenRow }
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(findWorkspaceEngine).mockResolvedValue(null)
    vi.mocked(getEngineHealth).mockResolvedValue({ status: 'ok', activeAgents: 0, capabilities: [] })
    vi.mocked(listConnections).mockResolvedValue({ connections: [] } as never)
})

describe('createPairingToken', () => {
    it('keeps only the hash of a token that lasts 15 minutes', async () => {
        const { token, expiresAt } = await createPairingToken(7, 'user-1')

        expect(token).toMatch(/^rrn_pair_/)
        const [insert] = db.writes('engine_pairing_tokens')
        expect(insert.payload).toMatchObject({ workspace_id: 7, created_by: 'user-1', token_hash: createHash('sha256').update(token).digest('hex') })
        expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000)
    })
})

describe('redeemPairingToken', () => {
    it('attaches a server it reached with the key it was handed', async () => {
        await expect(redeemPairingToken({ token: TOKEN, url: URL, apiKey: KEY })).resolves.toEqual({ workspaceId: 7 })

        expect(listConnections).toHaveBeenCalledWith({ baseUrl: URL, apiKey: KEY }, expect.anything())
        expect(attachCustomEngine).toHaveBeenCalledWith(7, { engineHost: URL, engineApiKey: KEY })
    })

    it('refuses a token that expired, or was already used', async () => {
        tokenRow = { ...tokenRow, expires_at: new Date(Date.now() - 1000).toISOString() }
        await expect(redeemPairingToken({ token: TOKEN, url: URL, apiKey: KEY })).rejects.toThrow('expired')

        tokenRow = { ...tokenRow, expires_at: new Date(Date.now() + 60_000).toISOString(), used_at: new Date().toISOString() }
        await expect(redeemPairingToken({ token: TOKEN, url: URL, apiKey: KEY })).rejects.toThrow('already used')
        expect(attachCustomEngine).not.toHaveBeenCalled()
    })

    it('says the server cannot be reached, and leaves the token for another try', async () => {
        vi.mocked(getEngineHealth).mockRejectedValue(new Error('ECONNREFUSED'))

        await expect(redeemPairingToken({ token: TOKEN, url: URL, apiKey: KEY })).rejects.toThrow('cannot reach your server at http://10.0.0.5:3000')
        expect(db.writes('engine_pairing_tokens')).toHaveLength(0)
    })

    it('refuses a workspace that already has a server', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i', conn: { baseUrl: URL, apiKey: KEY }, managed: false })

        await expect(redeemPairingToken({ token: TOKEN, url: URL, apiKey: KEY })).rejects.toThrow('already has a server')
    })

    it('attaches once when two servers race on one token', async () => {
        spend = { data: [] }

        await expect(redeemPairingToken({ token: TOKEN, url: URL, apiKey: KEY })).rejects.toThrow('already used')
        expect(attachCustomEngine).not.toHaveBeenCalled()
    })
})

describe('engineAddress', () => {
    it('takes the address the server gave, else where its request came from', () => {
        expect(engineAddress('engine.acme.com', '1.2.3.4')).toBe('http://engine.acme.com:3000')
        expect(engineAddress(null, '1.2.3.4')).toBe('http://1.2.3.4:3000')
        expect(engineAddress(undefined, null)).toBeNull()
    })
})

describe('detachWorkspaceServer', () => {
    it('never detaches a machine of the pool', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'i', conn: { baseUrl: URL, apiKey: KEY }, managed: true })

        await expect(detachWorkspaceServer(7)).rejects.toThrow('Moldwright Cloud')
        expect(db.writes('engine_pool')).toHaveLength(0)
    })
})
