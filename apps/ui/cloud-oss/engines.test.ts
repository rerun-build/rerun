import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type FakeSupabase, type SupabaseResult } from '@/test/supabase-fake'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { applyMachineSize, claimPoolEngine, desktopRelayBase, readMachine } = await import('./engines')

let db: FakeSupabase
let claimed: unknown
let insert: SupabaseResult

beforeEach(() => {
    claimed = null
    insert = { data: { id: 'pool-1' } }
    db = fakeSupabase((table, calls) => {
        if (table !== 'engine_pool') return undefined
        return calls.some(call => call.method === 'insert') ? insert : { data: claimed }
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.stubEnv('RERUN_ENGINE_URL', 'http://engine:3000')
    vi.stubEnv('RERUN_ENGINE_API_KEY', 'compose-key')
})

afterEach(() => vi.unstubAllEnvs())

describe('claimPoolEngine', () => {
    it('gives the engine of docker compose to the first workspace that needs one', async () => {
        await expect(claimPoolEngine(4)).resolves.toEqual({ ok: true, instance: { id: 'pool-1', engineHost: 'http://engine:3000', engineApiKey: 'compose-key' } })
        expect(db.writes('engine_pool')[0].payload).toMatchObject({ engine_host: 'http://engine:3000', engine_api_key: 'compose-key', claimed_by_workspace_id: 4, provider_server_id: null })
    })

    it('asks every other workspace to pair a server', async () => {
        claimed = { id: 'pool-1' }
        await expect(claimPoolEngine(5)).resolves.toMatchObject({ ok: false, raced: false })
        expect(db.writes('engine_pool')).toHaveLength(0)
    })

    it('reads a lost race as one, for the caller to read the winner back', async () => {
        insert = { error: { code: '23505', message: 'duplicate key' } }
        await expect(claimPoolEngine(4)).resolves.toMatchObject({ ok: false, raced: true })
    })

    it('has nothing to give without a compose engine', async () => {
        vi.stubEnv('RERUN_ENGINE_URL', '')
        await expect(claimPoolEngine(4)).resolves.toMatchObject({ ok: false, raced: false })
    })
})

describe('desktopRelayBase', () => {
    it('sends the browser to the address it can reach the compose engine at', async () => {
        vi.stubEnv('RERUN_ENGINE_BROWSER_URL', 'https://engine.acme.com/')
        await expect(desktopRelayBase('http://engine:3000', null, null)).resolves.toBe('wss://engine.acme.com')
    })

    it('leaves any other engine to be reached on its own address', async () => {
        vi.stubEnv('RERUN_ENGINE_BROWSER_URL', 'http://localhost:3001')
        await expect(desktopRelayBase('http://10.0.0.5:3000', null, null)).resolves.toBeNull()
    })
})

describe('the machine sizes', () => {
    it('are not sold on a self-hosted install: nothing to read, nothing to resize', async () => {
        await expect(readMachine(4)).resolves.toBeNull()
        await expect(applyMachineSize(4)).resolves.toBeUndefined()
        expect(db.calls).toEqual([])
    })
})

