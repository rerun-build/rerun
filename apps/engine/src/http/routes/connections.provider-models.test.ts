import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cxlive-'))

const { afterEach, beforeEach, describe, expect, it, vi } = await import('vitest')
const { RERUN_CONNECTION_ID } = await import('@moldwright/contracts')
const { connectionRoutes } = await import('./connections.js')
const { connectionsDir } = await import('../../config/paths.js')
const { ensureMoldwrightConnection } = await import('../../connections/store.js')
const { unloadConnection } = await import('../../connections/registry.js')
const { clearBoxDefault } = await import('../../connections/default.js')
const { providerDiscoveredModels, resetProviderCatalogForTests } = await import('../../connections/provider-catalog.js')
const { rm } = await import('node:fs/promises')

const openrouter = readFileSync(resolve(import.meta.dirname, '../../connections/__fixtures__/provider-models/openrouter.json'), 'utf8')
const ok = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })

let pending: ((response: Response) => void)[] = []
let mode: 'answer' | 'hold' = 'answer'

function send(method: string, path: string, body?: unknown) {
    return connectionRoutes.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

beforeEach(async () => {
    resetProviderCatalogForTests()
    pending = []
    mode = 'answer'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (mode === 'answer' ? ok(openrouter) : new Promise<Response>(done => pending.push(done))))
    unloadConnection(RERUN_CONNECTION_ID)
    await clearBoxDefault()
    await rm(connectionsDir(), { recursive: true, force: true })
    await ensureMoldwrightConnection()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the live model list through the connections API', () => {
    it('drops a read that was running with the old key, and none survives a delete', async () => {
        const created = (await (await send('POST', '/', { name: 'Router', provider: 'openrouter', keys: { OPENROUTER_API_KEY: 'sk-or-old' } })).json()) as { id: string; discoveredModels: unknown[] | null }
        expect(created.discoveredModels).toHaveLength(3)

        mode = 'hold'
        const keys = await send('PATCH', `/${created.id}/keys`, { set: { OPENROUTER_API_KEY: 'sk-or-new' }, remove: [] })
        expect(keys.status).toBe(200)
        expect(providerDiscoveredModels(created.id)).toBeNull()
        await vi.waitFor(() => expect(pending).toHaveLength(1))

        expect((await send('DELETE', `/${created.id}`)).status).toBe(200)
        pending[0](ok(openrouter))
        await vi.waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2))
        await new Promise(done => setImmediate(done))
        expect(providerDiscoveredModels(created.id)).toBeNull()
    })
})
