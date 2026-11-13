import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-vault-routes-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { migrate } = await import('../../db/migrate.js')
const { vaultDir, vaultItemDir, vaultItemEnvPath, vaultItemPath, vaultTokenPath } = await import('../../config/paths.js')
const { forgetVaultCache } = await import('../../vault/store.js')

const app = createServer()

type Summary = {
    id: string
    kind: string
    name: string
    label?: string
    status: string
    agentIds: string[]
    sharedWithAll: boolean
    envKeys: string[]
    tokens: string[]
    mcpServers: { name: string }[]
    createdBy: string | null
}

function send(method: string, path: string, body?: unknown) {
    return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T
}

async function createAgent(name: string): Promise<string> {
    const res = await send('POST', '/agents', { config: { name } })
    expect(res.status).toBe(201)
    return (await json<{ id: string }>(res)).id
}

async function createItem(body: Record<string, unknown>): Promise<Summary> {
    const res = await send('POST', '/vault', body)
    expect(res.status).toBe(201)
    return json<Summary>(res)
}

const secret = (name: string, env: Record<string, string>, extra: Record<string, unknown> = {}) => ({ kind: 'secret', name, env, ...extra })

const mode = async (path: string) => (await stat(path)).mode & 0o777

beforeAll(() => migrate())

beforeEach(async () => {
    await rm(vaultDir(), { recursive: true, force: true })
    forgetVaultCache()
})

describe('vault items', () => {
    it('lists nothing on a box without a Vault folder', async () => {
        const res = await send('GET', '/vault')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ items: [] })
    })

    it('creates an item and never hands its value back', async () => {
        const item = await createItem(secret('Stripe live key', { STRIPE_KEY: 'sk_live_very_secret' }, { createdBy: 'user-1' }))
        expect(item).toMatchObject({ kind: 'secret', name: 'Stripe live key', status: 'active', envKeys: ['STRIPE_KEY'], tokens: [], agentIds: [], sharedWithAll: false, createdBy: 'user-1' })

        const listed = await send('GET', '/vault')
        const text = await listed.text()
        expect(text).toContain('STRIPE_KEY')
        expect(text).not.toContain('sk_live_very_secret')
        expect(JSON.stringify(await json(await send('GET', `/vault/${item.id}`)))).not.toContain('sk_live_very_secret')

        expect(await readFile(vaultItemEnvPath(item.id), 'utf8')).toBe('STRIPE_KEY=sk_live_very_secret')
    })

    it('never shows a literal header or server variable, only placeholders', async () => {
        const item = await createItem({
            kind: 'mcp',
            name: 'Custom',
            mcpServers: [{ name: 'custom', url: 'https://c.test/mcp', headers: { Authorization: 'Bearer literal-secret', 'x-ref': '${CUSTOM_KEY}', 'x-bearer': 'Bearer ${CUSTOM_KEY}' }, env: { TOKEN: 'raw' } }],
        })
        const text = JSON.stringify(await json(await send('GET', `/vault/${item.id}`)))
        expect(text).not.toContain('literal-secret')
        expect(text).not.toContain('"raw"')
        expect(item.mcpServers[0]).toMatchObject({ headers: { Authorization: '•••', 'x-ref': '${CUSTOM_KEY}', 'x-bearer': 'Bearer ${CUSTOM_KEY}' }, env: { TOKEN: '•••' } })
        const roundTrip = await send('PATCH', `/vault/${item.id}`, { mcpServers: item.mcpServers })
        expect(roundTrip.status).toBe(400)
    })

    it('keeps an item readable by the engine user only', async () => {
        const item = await createItem(secret('Key', { A_KEY: 'v' }))
        expect(await mode(vaultItemDir(item.id))).toBe(0o700)
        expect(await mode(vaultItemPath(item.id))).toBe(0o600)
        expect(await mode(vaultItemEnvPath(item.id))).toBe(0o600)
    })

    it('stores a service with its compiled servers and skills', async () => {
        const item = await createItem({
            kind: 'service',
            slug: 'linear',
            name: 'Linear',
            label: 'ops@acme.test',
            status: 'needs_auth',
            authMethodId: 'oauth',
            mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp' }],
            skills: [{ slug: 'linear-triage', name: 'Linear triage', body: 'Use the linear tools.' }],
            oauth: { serverName: 'linear', url: 'https://mcp.linear.app/mcp' },
        })
        const read = await json<Summary & { skills: unknown[]; oauth: unknown }>(await send('GET', `/vault/${item.id}`))
        expect(read).toMatchObject({ slug: 'linear', label: 'ops@acme.test', status: 'needs_auth', oauth: { serverName: 'linear' } })
        expect(read.mcpServers).toEqual([{ name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp', args: [], env: {}, headers: {} }])
        expect(read.skills).toEqual([{ slug: 'linear-triage', name: 'Linear triage', description: '', body: 'Use the linear tools.' }])
    })

    it.each([
        ['an invalid variable name', secret('Bad', { 'NOT-A-VAR': 'v' })],
        ['a value on two lines', secret('Bad', { GOOD: 'one\ntwo' })],
        ['the reserved bridge server name', { kind: 'mcp', name: 'Bad', mcpServers: [{ name: 'rerun', url: 'https://x.test' }] }],
        ['an invalid server name', { kind: 'mcp', name: 'Bad', mcpServers: [{ name: 'has space', url: 'https://x.test' }] }],
        ['two servers under one name', { kind: 'mcp', name: 'Bad', mcpServers: [{ name: 'a', url: 'https://x.test' }, { name: 'a', url: 'https://y.test' }] }],
        ['two skills under one slug', { kind: 'service', name: 'Bad', skills: [{ slug: 's', name: 'S', body: 'b' }, { slug: 's', name: 'T', body: 'c' }] }],
        ['a paid app shared with everyone', { kind: 'service', name: 'LinkedIn', app: { appSlug: 'linkedin', serverName: 'linkedin' }, sharedWithAll: true }],
        ['an empty name', secret('   ', {})],
        ['an unknown kind', { kind: 'other', name: 'x' }],
    ])('refuses %s and writes nothing', async (_, body) => {
        const res = await send('POST', '/vault', body)
        expect(res.status).toBe(400)
        expect(existsSync(vaultDir()) ? (await json<{ items: unknown[] }>(await send('GET', '/vault'))).items : []).toEqual([])
    })

    it('refuses an attachment to a coworker that does not exist', async () => {
        const res = await send('POST', '/vault', secret('Key', { A_KEY: 'v' }, { agentIds: ['ghost'] }))
        expect(res.status).toBe(404)
        expect((await json<{ items: unknown[] }>(await send('GET', '/vault'))).items).toEqual([])
    })

    it('updates the fields it is sent and clears the ones set to null', async () => {
        const item = await createItem({ kind: 'service', slug: 'gmail', name: 'Gmail', label: 'me@acme.test', status: 'needs_auth', authMethodId: 'oauth' })
        const res = await send('PATCH', `/vault/${item.id}`, { status: 'active', label: null, authMethodId: null, name: 'Gmail support' })
        expect(res.status).toBe(200)
        const updated = await json<Summary & { authMethodId?: string }>(res)
        expect(updated).toMatchObject({ status: 'active', name: 'Gmail support', slug: 'gmail', kind: 'service' })
        expect(updated.label).toBeUndefined()
        expect(updated.authMethodId).toBeUndefined()
    })

    it('never lets a patch change the kind, the attachments or the author', async () => {
        const agent = await createAgent('Kind keeper')
        const item = await createItem(secret('Key', { K1: 'v' }, { agentIds: [agent], createdBy: 'user-1' }))
        const updated = await json<Summary>(await send('PATCH', `/vault/${item.id}`, { kind: 'service', agentIds: [], createdBy: 'user-2', name: 'Renamed' }))
        expect(updated).toMatchObject({ kind: 'secret', agentIds: [agent], createdBy: 'user-1', name: 'Renamed' })
    })

    it('sets and removes secrets, answering their names only', async () => {
        const item = await createItem(secret('Keys', { ONE: '1', TWO: '2' }))
        const res = await send('PATCH', `/vault/${item.id}/env`, { set: { THREE: 'three-value' }, remove: ['ONE'] })
        expect(await res.json()).toEqual({ keys: ['THREE', 'TWO'] })
        expect(await readFile(vaultItemEnvPath(item.id), 'utf8')).toContain('THREE=three-value')
        expect(await mode(vaultItemEnvPath(item.id))).toBe(0o600)
    })

    it('stores an OAuth token per server, readable by the engine user only', async () => {
        const item = await createItem({ kind: 'service', slug: 'linear', name: 'Linear', mcpServers: [{ name: 'linear', url: 'https://mcp.linear.app/mcp' }] })
        const put = await send('PUT', `/vault/${item.id}/tokens/linear`, { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: 123 })
        expect(put.status).toBe(200)
        const stored = JSON.parse(await readFile(vaultTokenPath(item.id, 'linear'), 'utf8'))
        expect(stored).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: 123 })
        expect(typeof stored.obtainedAt).toBe('number')
        expect(await mode(vaultTokenPath(item.id, 'linear'))).toBe(0o600)

        const summary = await json<Summary>(await send('GET', `/vault/${item.id}`))
        expect(summary.tokens).toEqual(['linear'])
        expect(JSON.stringify(summary)).not.toContain('at-1')

        expect((await send('DELETE', `/vault/${item.id}/tokens/linear`)).status).toBe(200)
        expect(existsSync(vaultTokenPath(item.id, 'linear'))).toBe(false)
        expect((await json<Summary>(await send('GET', `/vault/${item.id}`))).tokens).toEqual([])
    })

    it('refuses a token under a name that is not a server name', async () => {
        const item = await createItem(secret('Key', {}))
        expect((await send('PUT', `/vault/${item.id}/tokens/${encodeURIComponent('../escape')}`, { accessToken: 'x' })).status).toBe(400)
        expect((await send('PUT', `/vault/${item.id}/tokens/linear`, { refreshToken: 'no access token' })).status).toBe(400)
    })

    it('deletes an item and names the coworkers that lose it', async () => {
        const a = await createAgent('Loser A')
        const b = await createAgent('Keeper B')
        const item = await createItem(secret('Shared key', { SHARED_KEY: 'v' }, { agentIds: [a] }))
        expect(await json(await send('GET', `/vault/${item.id}/usage`))).toEqual({ agentIds: [a] })

        const res = await send('DELETE', `/vault/${item.id}`)
        expect(await res.json()).toEqual({ deleted: item.id, detached: [a] })
        expect(existsSync(vaultItemDir(item.id))).toBe(false)
        expect((await send('GET', `/vault/${item.id}`)).status).toBe(404)
        expect(b).toBeTruthy()
    })

    it('names every coworker as a user of an item shared with everyone', async () => {
        const a = await createAgent('Everyone A')
        const b = await createAgent('Everyone B')
        const item = await createItem(secret('Everyone key', { EVERY_KEY: 'v' }, { sharedWithAll: true }))
        const { agentIds } = await json<{ agentIds: string[] }>(await send('GET', `/vault/${item.id}/usage`))
        expect(agentIds).toEqual(expect.arrayContaining([a, b]))
    })

    it('skips an item it cannot read rather than failing the list', async () => {
        const good = await createItem(secret('Good', { GOOD_KEY: 'v' }))
        await mkdir(resolve(vaultDir(), 'broken'), { recursive: true })
        await writeFile(resolve(vaultDir(), 'broken', 'item.json'), '{ not json', 'utf8')
        await mkdir(resolve(vaultDir(), 'half-made'), { recursive: true })
        await writeFile(resolve(vaultDir(), 'half-made', '.env'), 'X=1', 'utf8')
        forgetVaultCache()
        const { items } = await json<{ items: Summary[] }>(await send('GET', '/vault'))
        expect(items.map(item => item.id)).toEqual([good.id])
    })

    it.each([
        ['GET', '/vault/ghost', undefined],
        ['PATCH', '/vault/ghost', { name: 'x' }],
        ['PATCH', '/vault/ghost/env', { set: { A: '1' } }],
        ['PUT', '/vault/ghost/agents/someone', undefined],
        ['DELETE', '/vault/ghost/agents/someone', undefined],
        ['PUT', '/vault/ghost/tokens/linear', { accessToken: 't' }],
        ['DELETE', '/vault/ghost/tokens/linear', undefined],
        ['GET', '/vault/ghost/usage', undefined],
        ['DELETE', '/vault/ghost', undefined],
        ['GET', `/vault/${encodeURIComponent('..')}`, undefined],
    ])('%s %s answers 404 on an unknown item', async (method, path, body) => {
        const res = await send(method, path, body)
        expect(res.status).toBe(404)
    })
})

describe('attachments', () => {
    it('attaches and detaches a coworker, both idempotent', async () => {
        const agent = await createAgent('Attach me')
        const item = await createItem(secret('Key', { ATTACH_KEY: 'v' }))
        expect((await json<Summary>(await send('PUT', `/vault/${item.id}/agents/${agent}`))).agentIds).toEqual([agent])
        expect((await json<Summary>(await send('PUT', `/vault/${item.id}/agents/${agent}`))).agentIds).toEqual([agent])
        expect((await json<Summary>(await send('DELETE', `/vault/${item.id}/agents/${agent}`))).agentIds).toEqual([])
        expect((await json<Summary>(await send('DELETE', `/vault/${item.id}/agents/${agent}`))).agentIds).toEqual([])
    })

    it('refuses to attach a coworker that does not exist', async () => {
        const item = await createItem(secret('Key', {}))
        expect((await send('PUT', `/vault/${item.id}/agents/ghost`)).status).toBe(404)
    })

    it('lists what one coworker draws on: its own items and the shared ones', async () => {
        const a = await createAgent('Lister A')
        const b = await createAgent('Lister B')
        const own = await createItem(secret('Own', { OWN_KEY: 'v' }, { agentIds: [a] }))
        const shared = await createItem(secret('Shared', { SHARED_ALL: 'v' }, { sharedWithAll: true }))
        await createItem(secret('Other', { OTHER_KEY: 'v' }, { agentIds: [b] }))
        const { items } = await json<{ items: Summary[] }>(await send('GET', `/vault?agent=${a}`))
        expect(items.map(item => item.id).sort()).toEqual([own.id, shared.id].sort())
    })

    it('keeps the selection when an item goes to everyone and back', async () => {
        const a = await createAgent('Selection A')
        const item = await createItem(secret('Key', { SEL_KEY: 'v' }, { agentIds: [a] }))
        expect(await json(await send('PATCH', `/vault/${item.id}`, { sharedWithAll: true }))).toMatchObject({ sharedWithAll: true, agentIds: [a] })
        expect(await json(await send('PATCH', `/vault/${item.id}`, { sharedWithAll: false }))).toMatchObject({ sharedWithAll: false, agentIds: [a] })
    })

    it('refuses to send a paid app to everyone', async () => {
        const item = await createItem({ kind: 'service', name: 'WhatsApp', app: { appSlug: 'whatsapp', serverName: 'whatsapp_pro' } })
        expect((await send('PATCH', `/vault/${item.id}`, { sharedWithAll: true })).status).toBe(400)
    })

    it('drops a deleted coworker from every item it was attached to', async () => {
        const a = await createAgent('Doomed coworker')
        const b = await createAgent('Survivor')
        const one = await createItem(secret('One', { ONE_KEY: 'v' }, { agentIds: [a, b] }))
        const two = await createItem(secret('Two', { TWO_KEY: 'v' }, { agentIds: [a] }))
        expect((await send('DELETE', `/agents/${a}`)).status).toBe(200)
        expect((await json<Summary>(await send('GET', `/vault/${one.id}`))).agentIds).toEqual([b])
        expect((await json<Summary>(await send('GET', `/vault/${two.id}`))).agentIds).toEqual([])
    })
})

describe('conflicts', () => {
    type Conflict = { error: string; conflicts: { agentId: string; itemId: string; kind: string; name: string }[] }

    it('refuses two values of one variable on the same coworker, and names them', async () => {
        const a = await createAgent('Conflicted')
        const first = await createItem(secret('First', { API_TOKEN: 'one' }, { agentIds: [a] }))
        const second = await createItem(secret('Second', { API_TOKEN: 'two' }))

        const res = await send('PUT', `/vault/${second.id}/agents/${a}`)
        expect(res.status).toBe(409)
        const body = await json<Conflict>(res)
        expect(body.error).toContain('API_TOKEN')
        expect(body.conflicts).toEqual([{ agentId: a, itemId: first.id, kind: 'env', name: 'API_TOKEN' }])
        expect((await json<Summary>(await send('GET', `/vault/${second.id}`))).agentIds).toEqual([])
    })

    it('lets two coworkers hold the same variable from different items', async () => {
        const a = await createAgent('Holder A')
        const b = await createAgent('Holder B')
        await createItem(secret('For A', { SAME_NAME: 'a' }, { agentIds: [a] }))
        const forB = await createItem(secret('For B', { SAME_NAME: 'b' }, { agentIds: [b] }))
        expect(forB.agentIds).toEqual([b])
    })

    it('refuses an item shared with everyone over one a coworker already holds', async () => {
        const a = await createAgent('Already holds')
        await createItem(secret('Own', { DUP_KEY: 'own' }, { agentIds: [a] }))
        const wide = await createItem(secret('Wide', { DUP_KEY: 'wide' }))
        expect((await send('PATCH', `/vault/${wide.id}`, { sharedWithAll: true })).status).toBe(409)
        expect((await send('POST', '/vault', secret('Wide 2', { DUP_KEY: 'x' }, { sharedWithAll: true }))).status).toBe(409)
    })

    it('refuses to attach next to an item shared with everyone that holds the same variable', async () => {
        const a = await createAgent('Next to everyone')
        await createItem(secret('Everyone', { EVERY_DUP: 'all' }, { sharedWithAll: true }))
        const own = await createItem(secret('Own', { EVERY_DUP: 'own' }))
        expect((await send('PUT', `/vault/${own.id}/agents/${a}`)).status).toBe(409)
    })

    it('refuses a new variable that clashes on a coworker already attached', async () => {
        const a = await createAgent('Env clash')
        await createItem(secret('One', { CLASH_ME: '1' }, { agentIds: [a] }))
        const two = await createItem(secret('Two', { OTHER: '2' }, { agentIds: [a] }))
        expect((await send('PATCH', `/vault/${two.id}/env`, { set: { CLASH_ME: '3' } })).status).toBe(409)
        expect(await readFile(vaultItemEnvPath(two.id), 'utf8')).toBe('OTHER=2')
    })

    it('refuses two servers under one name on the same coworker', async () => {
        const a = await createAgent('Server clash')
        await createItem({ kind: 'mcp', name: 'Docs', mcpServers: [{ name: 'docs', url: 'https://a.test/mcp' }], agentIds: [a] })
        const other = await createItem({ kind: 'mcp', name: 'Docs 2', mcpServers: [{ name: 'docs-2', url: 'https://b.test/mcp' }], agentIds: [a] })
        const res = await send('PATCH', `/vault/${other.id}`, { mcpServers: [{ name: 'docs', url: 'https://b.test/mcp' }] })
        expect(res.status).toBe(409)
        expect((await json<Conflict>(res)).conflicts[0]).toMatchObject({ kind: 'server', name: 'docs' })
    })

    it('refuses two items shared with everyone that clash, even before any coworker exists', async () => {
        await createItem(secret('First wide', { WIDE_ONLY: '1' }, { sharedWithAll: true }))
        const res = await send('POST', '/vault', secret('Second wide', { WIDE_ONLY: '2' }, { sharedWithAll: true }))
        expect(res.status).toBe(409)
        expect((await json<Conflict>(res)).conflicts[0]).toMatchObject({ agentId: '*', kind: 'env', name: 'WIDE_ONLY' })
    })

    it('refuses two apps writing a skill under one slug on the same coworker, but not two accounts of one app', async () => {
        const a = await createAgent('Skill clash')
        const skill = { slug: 'mail-howto', name: 'Mail how-to', body: 'Use the tools.' }
        await createItem({ kind: 'service', slug: 'gmail', name: 'Gmail', skills: [skill], agentIds: [a] })
        const second = await send('POST', '/vault', { kind: 'service', slug: 'gmail', name: 'Gmail 2', instanceId: 'abc123', skills: [skill], agentIds: [a] })
        expect(second.status).toBe(201)
        const other = await send('POST', '/vault', { kind: 'service', slug: 'outlook', name: 'Outlook', skills: [skill], agentIds: [a] })
        expect(other.status).toBe(409)
        expect((await json<Conflict>(other)).conflicts[0]).toMatchObject({ kind: 'skill', name: 'mail-howto' })
    })

    it('records a status change on an item even when nothing about what it puts on a coworker moved', async () => {
        const a = await createAgent('Status only')
        const item = await createItem(secret('Status', { STATUS_KEY: 'v' }, { agentIds: [a] }))
        expect((await send('PATCH', `/vault/${item.id}`, { status: 'needs_auth', label: 'x' })).status).toBe(200)
    })

    it('lets only one of two clashing attachments made at once through', async () => {
        const a = await createAgent('Race')
        const one = await createItem(secret('One', { RACE_KEY: '1' }))
        const two = await createItem(secret('Two', { RACE_KEY: '2' }))
        const results = await Promise.all([send('PUT', `/vault/${one.id}/agents/${a}`), send('PUT', `/vault/${two.id}/agents/${a}`)])
        expect(results.map(r => r.status).sort()).toEqual([200, 409])
        const { items } = await json<{ items: Summary[] }>(await send('GET', `/vault?agent=${a}`))
        expect(items).toHaveLength(1)
    })
})
