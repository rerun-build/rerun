import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-vault-adopt-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, readFile, readdir, rm, writeFile } = await import('node:fs/promises')
const { existsSync } = await import('node:fs')
const { createServer } = await import('../http/server.js')
const { migrate } = await import('../db/migrate.js')
const { agentDir, agentEnvPath, configPath, mcpTokenPath, vaultDir, workspaceDir } = await import('../config/paths.js')
const { DATA_DIR_MIGRATIONS } = await import('../datadir/migrations.js')
const { runDataDirChecks } = await import('../datadir/checks.js')
const { detachVaultItem, forgetVaultCache, listVaultItems } = await import('./store.js')
const { loadVaultToken, saveVaultToken, clearVaultToken } = await import('./tokens.js')
const { takeNewerAdoptedTokens } = await import('./adopt.js')

const app = createServer()
const step = DATA_DIR_MIGRATIONS.find(s => s.id === 'vault-adopt')!

function send(method: string, path: string, body?: unknown) {
    return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function agent(name: string): Promise<string> {
    const res = await send('POST', '/agents', { config: { name, displayName: name.toUpperCase() } })
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
}

type Entry = Record<string, unknown>
const server = (name: string, extra: Record<string, unknown> = {}) => ({ name, transport: 'http', url: `https://${name}.test/mcp`, ...extra })

// What a hub from before the Vault writes when it installs an app on a coworker: servers in its
// config, keys in its `.env`, a token in `mcp/`, and the registry entry naming all of it.
async function install(id: string, key: string, entry: Entry, servers: ReturnType<typeof server>[], keys: Record<string, string> = {}, tokens: Record<string, object> = {}) {
    expect((await send('PATCH', `/agents/${id}/mcp-servers`, { upsert: servers })).status).toBe(200)
    if (Object.keys(keys).length) expect((await send('PATCH', `/agents/${id}/keys`, { set: keys })).status).toBe(200)
    for (const [name, token] of Object.entries(tokens)) {
        await mkdir(resolve(agentDir(id), 'mcp'), { recursive: true })
        await writeFile(mcpTokenPath(id, name), JSON.stringify(token))
    }
    const path = resolve(workspaceDir(id), '.rerun', 'services.json')
    const current = existsSync(path) ? (JSON.parse(await readFile(path, 'utf8')) as { services: Record<string, Entry> }) : { services: {} }
    current.services[key] = { status: 'active', config: {}, mcpServers: servers.map(s => s.name), envKeys: Object.keys(keys), skills: [], installedAt: '2026-10-01T00:00:00.000Z', ...entry }
    await mkdir(resolve(workspaceDir(id), '.rerun'), { recursive: true })
    await writeFile(path, JSON.stringify(current))
}

async function snapshot(id: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {}
    const read = async (path: string) => (existsSync(path) ? readFile(path, 'utf8') : '')
    files.config = await read(configPath(id))
    files.env = await read(agentEnvPath(id))
    files.registry = await read(resolve(workspaceDir(id), '.rerun', 'services.json'))
    const mcp = resolve(agentDir(id), 'mcp')
    for (const name of existsSync(mcp) ? await readdir(mcp) : []) files[`mcp/${name}`] = await read(resolve(mcp, name))
    return files
}

const token = (access: string, obtainedAt: number) => ({ accessToken: access, refreshToken: `r-${access}`, obtainedAt })

beforeAll(() => migrate())

beforeEach(async () => {
    const { agents } = (await (await send('GET', '/agents')).json()) as { agents: { id: string }[] }
    for (const { id } of agents) await send('DELETE', `/agents/${id}`)
    await rm(vaultDir(), { recursive: true, force: true })
    await mkdir(vaultDir(), { recursive: true })
    forgetVaultCache()
})

describe('v5 to v6: vault-adopt', () => {
    it('makes an item of every catalog app of a coworker, attached to it alone, and leaves its folder as it was', async () => {
        const a = await agent('ada')
        await install(a, 'linear', { oauth: { serverName: 'linear', url: 'https://linear.test/mcp' }, label: 'ops@acme.test' }, [server('linear', { headers: { 'x-rerun-agent': a } })], {}, { linear: token('lin-1', 1000) })
        await install(a, 'notion', { authMethodId: 'api-key' }, [server('notion', { headers: { Authorization: 'Bearer ${RERUN_SVC_NOTION_KEY}' } })], { RERUN_SVC_NOTION_KEY: 'secret_notion_ada' })
        await install(a, 'typeform', { status: 'active', managed: { provider: 'typeform', serverName: 'typeform' } }, [server('typeform')], {}, { typeform: token('tf-1', 1000) })
        await install(a, 'gmail', { composio: { toolkit: 'gmail', serverName: 'gmail', connectedAccountId: 'ca_1' } }, [server('gmail')])
        await install(a, 'linkedin-pro', { app: { appSlug: 'linkedin', serverName: 'linkedin' } }, [server('linkedin')])
        const before = await snapshot(a)

        await step.up()

        const items = await listVaultItems()
        const bySlug = new Map(items.map(item => [item.config.slug, item]))
        expect([...bySlug.keys()].sort()).toEqual(['linear', 'notion', 'typeform'])
        const linear = bySlug.get('linear')!
        expect(linear.config).toMatchObject({ kind: 'service', status: 'active', label: 'ops@acme.test', agentIds: [a], sharedWithAll: false, createdBy: null, oauth: { serverName: 'linear' } })
        expect(linear.config.mcpServers[0].headers['x-rerun-agent']).toBe('${RERUN_AGENT_ID}')
        expect((await loadVaultToken(linear.id, 'linear'))?.accessToken).toBe('lin-1')
        const notion = bySlug.get('notion')!
        expect(notion.env).toEqual({ RERUN_SVC_NOTION_KEY: 'secret_notion_ada' })
        expect(notion.config).toMatchObject({ authMethodId: 'api-key', agentIds: [a] })
        expect((await loadVaultToken(bySlug.get('typeform')!.id, 'typeform'))?.accessToken).toBe('tf-1')

        expect(await snapshot(a)).toEqual(before)
        const doctor = await runDataDirChecks()
        expect(doctor.checks.find(c => c.name === 'vault')).toMatchObject({ ok: true, detail: '3 item(s)' })
    })

    it('runs twice to the same Vault', async () => {
        const a = await agent('bea')
        await install(a, 'notion', {}, [server('notion')], { RERUN_SVC_NOTION_KEY: 'k' })
        await step.up()
        const first = await listVaultItems()
        await step.up()
        forgetVaultCache()
        expect(await listVaultItems()).toEqual(first)
    })

    it('merges coworkers keyed with the same values, never different keys nor sign-ins', async () => {
        const same = [await agent('c1'), await agent('c2'), await agent('c3')]
        for (const id of same) await install(id, 'notion', {}, [server('notion', { headers: { Authorization: 'Bearer ${RERUN_SVC_NOTION_KEY}' } })], { RERUN_SVC_NOTION_KEY: 'shared_key' })
        const other = await agent('c4')
        await install(other, 'notion', {}, [server('notion', { headers: { Authorization: 'Bearer ${RERUN_SVC_NOTION_KEY}' } })], { RERUN_SVC_NOTION_KEY: 'another_key' })
        const signedIn = [await agent('c5'), await agent('c6')]
        for (const id of signedIn) await install(id, 'linear', { oauth: { serverName: 'linear', url: 'https://linear.test/mcp' }, label: 'ops@acme.test' }, [server('linear')], {}, { linear: token('same-account', 1) })

        await step.up()

        const items = await listVaultItems()
        const notion = items.filter(item => item.config.slug === 'notion')
        expect(notion.map(item => item.config.agentIds.length).sort()).toEqual([1, 3])
        const shared = notion.find(item => item.config.agentIds.length === 3)!
        expect([...shared.config.agentIds].sort()).toEqual([...same].sort())
        expect(shared.config.label).toBeUndefined()
        expect(notion.find(item => item.config.agentIds.length === 1)!.config.label).toBe('C4')
        expect(items.filter(item => item.config.slug === 'linear').map(item => item.config.agentIds)).toEqual(expect.arrayContaining([[signedIn[0]], [signedIn[1]]]))
    })

    it('keeps every account of an app with several', async () => {
        const a = await agent('dan')
        await install(a, 'gmail-key', { label: 'perso' }, [server('mail')], { RERUN_SVC_MAIL_KEY: 'one' })
        await install(a, 'gmail-key@k2', { label: 'support', instanceId: 'k2' }, [server('mail-k2')], { RERUN_SVC_MAIL_KEY_K2: 'two' })
        await step.up()
        const items = (await listVaultItems()).filter(item => item.config.agentIds.includes(a))
        expect(items.map(item => [item.config.label, item.config.instanceId ?? null]).sort()).toEqual([
            ['perso', null],
            ['support', 'k2'],
        ])
    })

    it('never undoes a detach, and adopts an app installed again', async () => {
        const a = await agent('eve')
        await install(a, 'notion', {}, [server('notion')], { RERUN_SVC_NOTION_KEY: 'k' })
        await step.up()
        const [item] = await listVaultItems()
        await detachVaultItem(item.id, a)
        await step.up()
        expect((await listVaultItems()).filter(candidate => candidate.config.agentIds.includes(a))).toEqual([])

        await install(a, 'notion', { installedAt: '2026-11-13T00:00:00.000Z' }, [server('notion')], { RERUN_SVC_NOTION_KEY: 'k2' })
        await step.up()
        expect((await listVaultItems()).filter(candidate => candidate.config.agentIds.includes(a)).map(candidate => candidate.env)).toEqual([{ RERUN_SVC_NOTION_KEY: 'k2' }])
    })
})

describe('tokens of an adopted item, while the copies last', () => {
    it('writes every new token back into the copy it came from, and takes back a newer copy', async () => {
        const a = await agent('fay')
        await install(a, 'linear', { oauth: { serverName: 'linear', url: 'https://linear.test/mcp' } }, [server('linear')], {}, { linear: token('t1', 1000) })
        await step.up()
        const [item] = await listVaultItems()

        await saveVaultToken(item.id, 'linear', token('t2', 2000))
        expect(JSON.parse(await readFile(mcpTokenPath(a, 'linear'), 'utf8')).accessToken).toBe('t2')

        // An engine from before the Vault ran in between and refreshed its copy.
        await writeFile(mcpTokenPath(a, 'linear'), JSON.stringify(token('t3', 3000)))
        await takeNewerAdoptedTokens()
        expect((await loadVaultToken(item.id, 'linear'))?.accessToken).toBe('t3')

        // Signed out from the Vault: the copy does not sign it back in.
        await clearVaultToken(item.id, 'linear')
        await writeFile(mcpTokenPath(a, 'linear'), JSON.stringify(token('t4', 4000)))
        await takeNewerAdoptedTokens()
        expect(await loadVaultToken(item.id, 'linear')).toBeNull()
    })

    it('never writes into a coworker the item was attached to later', async () => {
        const a = await agent('gus')
        const b = await agent('hal')
        await install(a, 'linear', { oauth: { serverName: 'linear', url: 'https://linear.test/mcp' } }, [server('linear')], {}, { linear: token('a1', 1000) })
        await step.up()
        const [item] = await listVaultItems()
        await mkdir(resolve(agentDir(b), 'mcp'), { recursive: true })
        await writeFile(mcpTokenPath(b, 'linear'), JSON.stringify(token('b-own', 1000)))
        await send('PUT', `/vault/${item.id}/agents/${b}`)
        await saveVaultToken(item.id, 'linear', token('a2', 2000))
        expect(JSON.parse(await readFile(mcpTokenPath(b, 'linear'), 'utf8')).accessToken).toBe('b-own')
    })
})
