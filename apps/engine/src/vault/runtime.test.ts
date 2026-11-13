import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-vault-runtime-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_LOG_LEVEL = 'fatal'

const { afterEach, beforeAll, beforeEach, describe, expect, it, vi } = await import('vitest')

const notified = vi.hoisted(() => [] as Array<{ event?: string; metadata?: Record<string, unknown> | null }>)
vi.mock('../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../runtime/notify.js')>()),
    sendNotification: async (input: { event?: string; metadata?: Record<string, unknown> | null }) => {
        notified.push(input)
        return { delivered: true }
    },
}))

const { readFile, rm, writeFile, mkdir } = await import('node:fs/promises')
const { createServer } = await import('../http/server.js')
const { migrate } = await import('../db/migrate.js')
const { vaultDir, vaultTokenPath, skillDir, skillsDir, workspaceDir, configPath } = await import('../config/paths.js')
const { forgetVaultCache, getVaultItem } = await import('./store.js')
const { agentMcpServers, vaultEnvFor, vaultAgentId } = await import('./runtime.js')
const { prepareMcpServer } = await import('../tools/mcp.js')
const { agentProcessEnv } = await import('../agents/process-env.js')
const { agentMcpSpawn } = await import('../tools/mcp-pool.js')
const { getAgent, unloadAgent } = await import('../agents/registry.js')
const { saveVaultToken } = await import('./tokens.js')
const { buildMcpIndex } = await import('../tools/mcp-index.js')
const { connectorSkillOwners } = await import('../services/registry.js')
const { reconcileVault } = await import('./apply.js')
const { setEnv } = await import('../config/env.js')

const app = createServer()

function send(method: string, path: string, body?: unknown) {
    return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function createAgent(name: string): Promise<string> {
    const res = await send('POST', '/agents', { config: { name } })
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
}

async function createItem(body: Record<string, unknown>): Promise<string> {
    const res = await send('POST', '/vault', body)
    expect(res.status, await res.clone().text()).toBe(201)
    return ((await res.json()) as { id: string }).id
}

async function loaded(id: string) {
    unloadAgent(id)
    return getAgent(id)
}

const originalFetch = globalThis.fetch
let refreshCalls = 0

function mockTokenEndpoint(respond: () => Response) {
    refreshCalls = 0
    globalThis.fetch = vi.fn(async () => {
        refreshCalls++
        await new Promise(done => setTimeout(done, 20))
        return respond()
    }) as unknown as typeof fetch
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const linearItem = (agentIds: string[], extra: Record<string, unknown> = {}) => ({
    kind: 'service',
    slug: 'linear',
    name: 'Linear',
    mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.test/mcp' }],
    agentIds,
    ...extra,
})

beforeAll(() => migrate())

beforeEach(async () => {
    await rm(vaultDir(), { recursive: true, force: true })
    forgetVaultCache()
    notified.length = 0
})

afterEach(() => {
    globalThis.fetch = originalFetch
    process.env.RERUN_HUB_BASE_URL = ''
    process.env.RERUN_API_KEY = ''
    setEnv({ RERUN_HUB_BASE_URL: undefined, RERUN_API_KEY: undefined })
})

describe('what a coworker draws on', () => {
    it('gets the servers and the variables of the items attached to it, and nothing of the others', async () => {
        const a = await createAgent('Attached')
        const c = await createAgent('Not attached')
        await createItem({ ...linearItem([a]), env: { LINEAR_EXTRA: 'for-a' } })

        expect(agentMcpServers(await loaded(a)).map(s => s.name)).toEqual(['linear'])
        expect(vaultEnvFor(await loaded(a))).toEqual({ LINEAR_EXTRA: 'for-a' })
        expect(agentProcessEnv(await loaded(a)).env.LINEAR_EXTRA).toBe('for-a')

        expect(agentMcpServers(await loaded(c))).toEqual([])
        expect(vaultEnvFor(await loaded(c))).toEqual({})
        expect(agentProcessEnv(await loaded(c)).env.LINEAR_EXTRA).toBeUndefined()
    })

    it('gives an item shared with everyone to every coworker, the foreman excepted', async () => {
        const a = await createAgent('Everyone A')
        const b = await createAgent('Everyone B')
        await createItem({ kind: 'secret', name: 'Shared', env: { SHARED_ALL: 'x' }, sharedWithAll: true })
        expect(vaultEnvFor(await loaded(a))).toEqual({ SHARED_ALL: 'x' })
        expect(vaultEnvFor(await loaded(b))).toEqual({ SHARED_ALL: 'x' })
        expect(vaultAgentId({ id: 'f', config: { kind: 'foreman' } as never })).toBeNull()
        expect(vaultEnvFor({ id: 'f', config: { kind: 'foreman', mcpServers: [] } as never })).toEqual({})
    })

    it('lets a delegate draw on the Vault of the coworker it works for', async () => {
        const boss = await createAgent('Boss')
        await createItem(linearItem([boss]))
        const delegate = { id: 'delegate-x', config: (await loaded(boss)).config, hubAgentId: boss }
        expect(agentMcpServers(delegate).map(s => s.name)).toEqual(['linear'])
    })

    it("puts an item's server in place of the coworker's own copy under the same name", async () => {
        const a = await createAgent('Migrated')
        const res = await send('PATCH', `/agents/${a}/mcp-servers`, { upsert: [{ name: 'linear', url: 'https://old.test/mcp' }, { name: 'own', url: 'https://own.test/mcp' }] })
        expect(res.status).toBe(200)
        await createItem(linearItem([a]))
        const servers = agentMcpServers(await loaded(a))
        expect(servers.map(s => [s.name, s.url, s.vaultItemId !== undefined])).toEqual([
            ['linear', 'https://mcp.linear.test/mcp', true],
            ['own', 'https://own.test/mcp', false],
        ])
    })

    it("lets the Vault's value win over the coworker's own .env", async () => {
        const a = await createAgent('Override')
        await send('PATCH', `/agents/${a}/keys`, { set: { NOTION_KEY: 'old', OWN_ONLY: 'mine' } })
        await createItem({ kind: 'secret', name: 'Notion', env: { NOTION_KEY: 'new' }, agentIds: [a] })
        const env = agentProcessEnv(await loaded(a)).env
        expect(env.NOTION_KEY).toBe('new')
        expect(env.OWN_ONLY).toBe('mine')
    })

    it('stops serving an item the moment it is detached', async () => {
        const a = await createAgent('Detached')
        const id = await createItem({ ...linearItem([a]), env: { GONE_KEY: 'v' } })
        await send('DELETE', `/vault/${id}/agents/${a}`)
        const agent = await loaded(a)
        expect(agentMcpServers(agent)).toEqual([])
        expect(agentProcessEnv(agent).env.GONE_KEY).toBeUndefined()
    })
})

describe('preparing a Vault server', () => {
    it("resolves ${VAR} against its own item only, never another item's nor the coworker's", async () => {
        const a = await createAgent('Isolated')
        await send('PATCH', `/agents/${a}/keys`, { set: { OWN_SECRET: 'own-value' } })
        await createItem({ kind: 'secret', name: 'Other', env: { OTHER_SECRET: 'other-value' }, agentIds: [a] })
        await createItem({
            kind: 'mcp',
            name: 'Docs',
            env: { DOCS_TOKEN: 'docs-value' },
            agentIds: [a],
            mcpServers: [{ name: 'docs', url: 'https://docs.test/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}', 'x-other': '${OTHER_SECRET}', 'x-own': '${OWN_SECRET}' } }],
        })
        const agent = await loaded(a)
        const docs = agentMcpServers(agent).find(s => s.name === 'docs')!
        const prepared = await prepareMcpServer(agent.id, docs, agentProcessEnv(agent).env)
        expect(prepared.headers).toEqual({ Authorization: 'Bearer docs-value', 'x-other': '', 'x-own': '' })
        expect(prepared).not.toHaveProperty('vaultItemId')
    })

    it('names the calling coworker in ${RERUN_AGENT_ID}, the one a delegate works for', async () => {
        const a = await createAgent('Caller')
        await createItem({ kind: 'mcp', name: 'Tracker', agentIds: [a], mcpServers: [{ name: 'tracker', url: 'https://t.test/mcp?agent=${RERUN_AGENT_ID}' }] })
        const server = agentMcpServers(await loaded(a))[0]
        expect((await prepareMcpServer(a, server, {})).url).toBe(`https://t.test/mcp?agent=${a}`)
        expect((await prepareMcpServer('delegate-1', server, {}, a)).url).toBe(`https://t.test/mcp?agent=${a}`)
    })

    it('tells the hub which item a server of its own came from, and never lets a coworker claim one', async () => {
        const a = await createAgent('Hub caller')
        await send('PATCH', `/agents/${a}/mcp-servers`, { upsert: [{ name: 'forged', url: 'https://hub.test/api/mcp/composio/gmail', headers: { 'x-rerun-vault-item': 'someone-else' } }] })
        const id = await createItem({ kind: 'service', slug: 'gmail', name: 'Gmail', agentIds: [a], mcpServers: [{ name: 'gmail', url: '${RERUN_HUB_BASE_URL}/api/mcp/composio/gmail' }] })
        const agent = await loaded(a)
        setEnv({ RERUN_HUB_BASE_URL: 'https://hub.test', RERUN_API_KEY: 'engine-key' })
        const [gmail, forged] = await Promise.all(agentMcpServers(agent).map(s => prepareMcpServer(agent.id, s, agent.env)))
        expect(gmail.headers).toEqual({ 'x-rerun-key': 'engine-key', 'x-rerun-agent': a, 'x-rerun-vault-item': id })
        expect(forged.headers).toEqual({ 'x-rerun-key': 'engine-key', 'x-rerun-agent': a })
    })

    it('takes the bearer from the item, and refreshes it once for every coworker drawing on it', async () => {
        const a = await createAgent('Runner A')
        const b = await createAgent('Runner B')
        const id = await createItem(linearItem([a, b]))
        await saveVaultToken(id, 'linear', { accessToken: 'expired', refreshToken: 'rt-1', expiresAt: Date.now() - 1000, tokenEndpoint: 'https://auth.test/token', clientId: 'c', obtainedAt: 0 })
        mockTokenEndpoint(() => json({ access_token: 'fresh', refresh_token: 'rt-2', expires_in: 3600 }))

        const [agentA, agentB] = await Promise.all([loaded(a), loaded(b)])
        const runs = await Promise.all([
            ...agentMcpServers(agentA).map(s => prepareMcpServer(a, s, agentA.env)),
            ...agentMcpServers(agentB).map(s => prepareMcpServer(b, s, agentB.env)),
            ...agentMcpServers(agentA).map(s => prepareMcpServer(a, s, agentA.env)),
        ])
        expect(refreshCalls).toBe(1)
        expect(runs.map(server => server.headers.Authorization)).toEqual(['Bearer fresh', 'Bearer fresh', 'Bearer fresh'])
        const stored = JSON.parse(await readFile(vaultTokenPath(id, 'linear'), 'utf8'))
        expect(stored).toMatchObject({ accessToken: 'fresh', refreshToken: 'rt-2', tokenEndpoint: 'https://auth.test/token' })
    })

    it('marks the item signed out when the provider refuses the refresh for good, and tells the hub', async () => {
        const a = await createAgent('Refused')
        const id = await createItem(linearItem([a], { status: 'active' }))
        await saveVaultToken(id, 'linear', { accessToken: 'stale', refreshToken: 'revoked', expiresAt: Date.now() - 1000, tokenEndpoint: 'https://auth.test/token', obtainedAt: 0 })
        mockTokenEndpoint(() => json({ error: 'invalid_grant' }, 400))
        const agent = await loaded(a)
        const prepared = await prepareMcpServer(a, agentMcpServers(agent)[0], agent.env)
        expect(prepared.headers.Authorization).toBe('Bearer stale')
        expect((await getVaultItem(id)).config.status).toBe('needs_auth')
        expect(notified).toEqual([expect.objectContaining({ event: 'box.vault.signed_out', metadata: { itemId: id, slug: 'linear' } })])
    })

    it('leaves the item as it is when the refresh only failed to go through', async () => {
        const a = await createAgent('Transient')
        const id = await createItem(linearItem([a]))
        await saveVaultToken(id, 'linear', { accessToken: 'stale', refreshToken: 'rt', expiresAt: Date.now() - 1000, tokenEndpoint: 'https://auth.test/token', obtainedAt: 0 })
        mockTokenEndpoint(() => json({ error: 'temporarily_unavailable' }, 503))
        const agent = await loaded(a)
        await prepareMcpServer(a, agentMcpServers(agent)[0], agent.env)
        expect((await getVaultItem(id)).config.status).toBe('active')
        expect(notified).toEqual([])
    })

    it('marks an item signed out once its token expired with nothing to refresh it with', async () => {
        const a = await createAgent('No refresh token')
        const id = await createItem(linearItem([a]))
        await saveVaultToken(id, 'linear', { accessToken: 'stale', expiresAt: Date.now() - 1000, tokenEndpoint: 'https://auth.test/token', obtainedAt: 0 })
        const agent = await loaded(a)
        await prepareMcpServer(a, agentMcpServers(agent)[0], agent.env)
        expect((await getVaultItem(id)).config.status).toBe('needs_auth')
    })

    it("keeps a sign-in made while a refresh was out, rather than the old lineage's answer", async () => {
        const a = await createAgent('Reconnected')
        const id = await createItem(linearItem([a]))
        await saveVaultToken(id, 'linear', { accessToken: 'stale', refreshToken: 'old-lineage', expiresAt: Date.now() - 1000, tokenEndpoint: 'https://auth.test/token', obtainedAt: 0 })
        globalThis.fetch = vi.fn(async () => {
            await saveVaultToken(id, 'linear', { accessToken: 'reconnected', refreshToken: 'new-lineage', expiresAt: Date.now() + 3_600_000, obtainedAt: Date.now() })
            return json({ error: 'invalid_grant' }, 400)
        }) as unknown as typeof fetch
        const agent = await loaded(a)
        const prepared = await prepareMcpServer(a, agentMcpServers(agent)[0], agent.env)
        expect(prepared.headers.Authorization).toBe('Bearer reconnected')
        expect((await getVaultItem(id)).config.status).toBe('active')
        expect(JSON.parse(await readFile(vaultTokenPath(id, 'linear'), 'utf8')).refreshToken).toBe('new-lineage')
    })

    it('never brings back the folder of an item deleted while its refresh was out', async () => {
        const id = await createItem(linearItem([]))
        await send('DELETE', `/vault/${id}`)
        await saveVaultToken(id, 'linear', { accessToken: 'late', obtainedAt: 0 })
        expect(existsSync(resolve(vaultDir(), id))).toBe(false)
    })

    it("starts an item's command with that item's secrets, and never another item's", async () => {
        const a = await createAgent('Stdio')
        await createItem({ kind: 'secret', name: 'Other', env: { OTHER_ITEM_SECRET: 'nope' }, agentIds: [a] })
        await createItem({ kind: 'mcp', name: 'Local', env: { LOCAL_KEY: 'mine' }, agentIds: [a], mcpServers: [{ name: 'local', command: 'node', args: ['server.js'] }] })
        const agent = await loaded(a)
        const local = agentMcpServers(agent).find(s => s.name === 'local')!
        const prepared = await prepareMcpServer(a, local, agent.env)
        expect(prepared.env).toEqual({ LOCAL_KEY: 'mine' })
        const spawn = agentMcpSpawn(agent)
        expect(spawn.env.OTHER_ITEM_SECRET).toBeUndefined()
        expect(spawn.env.LOCAL_KEY).toBeUndefined()
        expect(agentProcessEnv(agent).env.OTHER_ITEM_SECRET).toBe('nope')
    })

    it("never reads the coworker's own token for an item's server", async () => {
        const a = await createAgent('Own token')
        const { saveToken } = await import('../tools/mcp-auth.js')
        await saveToken(a, 'linear', { accessToken: 'agent-copy', obtainedAt: 0 })
        const id = await createItem(linearItem([a]))
        await saveVaultToken(id, 'linear', { accessToken: 'vault-token', obtainedAt: 0 })
        const agent = await loaded(a)
        expect((await prepareMcpServer(a, agentMcpServers(agent)[0], agent.env)).headers.Authorization).toBe('Bearer vault-token')
    })
})

describe('what the model is told', () => {
    it('lists a Vault server with where its app stands', async () => {
        const a = await createAgent('Indexed')
        await createItem(linearItem([a], { status: 'needs_auth', label: 'ops@acme.test' }))
        const index = await buildMcpIndex(await loaded(a))
        expect(index).toContain('- linear (http): not connected yet (app "linear", account ops@acme.test)')
        expect(index).toContain('not connected yet')
    })

    it('calls an authenticated custom server of the Vault authenticated by its token', async () => {
        const a = await createAgent('Custom indexed')
        const id = await createItem({ kind: 'mcp', name: 'Docs', agentIds: [a], mcpServers: [{ name: 'docs', url: 'https://docs.test/mcp' }] })
        await saveVaultToken(id, 'docs', { accessToken: 't', obtainedAt: 0 })
        expect(await buildMcpIndex(await loaded(a))).toContain('- docs (http): authenticated (OAuth)')
    })

    it('answers the live status of a Vault server from the status route', async () => {
        const a = await createAgent('Status')
        await createItem({ kind: 'mcp', name: 'Down', agentIds: [a], mcpServers: [{ name: 'down', command: '/nonexistent/binary' }] })
        const res = await send('GET', `/agents/${a}/mcp-servers/status`)
        const { servers } = (await res.json()) as { servers: Array<{ name: string; status: string }> }
        expect(servers.map(s => [s.name, s.status])).toEqual([['down', 'error']])
    })
})

describe('skills of an item', () => {
    const skill = { slug: 'linear-triage', name: 'Linear triage', description: 'How to triage', body: 'Use linear_list_issues first.' }

    it('writes them into the folder of every coworker attached, and takes them back on detach', async () => {
        const a = await createAgent('Skilled')
        const id = await createItem(linearItem([a], { skills: [skill] }))
        const skillFile = resolve(skillDir(a, 'linear-triage'), 'SKILL.md')
        expect(await readFile(skillFile, 'utf8')).toContain('Use linear_list_issues first.')
        expect((await connectorSkillOwners(a)).get('linear-triage')).toBe('linear')

        await send('PATCH', `/vault/${id}`, { skills: [{ ...skill, body: 'Updated procedure.' }] })
        expect(await readFile(skillFile, 'utf8')).toContain('Updated procedure.')

        await send('DELETE', `/vault/${id}/agents/${a}`)
        expect(existsSync(skillFile)).toBe(false)
        expect((await connectorSkillOwners(a)).has('linear-triage')).toBe(false)
    })

    it("never removes a skill the coworker's own connector installed under the same slug", async () => {
        const a = await createAgent('Own connector')
        await mkdir(resolve(workspaceDir(a), '.rerun'), { recursive: true })
        await writeFile(resolve(workspaceDir(a), '.rerun', 'services.json'), JSON.stringify({ services: { linear: { status: 'active', skills: ['linear-triage'] } } }), 'utf8')
        const id = await createItem(linearItem([a], { skills: [skill] }))
        await send('DELETE', `/vault/${id}`)
        expect(existsSync(resolve(skillDir(a, 'linear-triage'), 'SKILL.md'))).toBe(true)
    })

    it("never overwrites nor removes a skill the user wrote under the same slug", async () => {
        const a = await createAgent('Own skill')
        const res = await send('POST', `/agents/${a}/skills`, { name: 'linear-triage', description: 'mine', body: 'My own procedure.' })
        expect(res.status).toBeLessThan(300)
        const skillFile = resolve(skillDir(a, 'linear-triage'), 'SKILL.md')
        const id = await createItem(linearItem([a], { skills: [skill] }))
        expect(await readFile(skillFile, 'utf8')).toContain('My own procedure.')
        await send('DELETE', `/vault/${id}/agents/${a}`)
        expect(await readFile(skillFile, 'utf8')).toContain('My own procedure.')
    })

    it('gives a coworker created later the skills of the items shared with everyone', async () => {
        await createItem(linearItem([], { sharedWithAll: true, skills: [skill] }))
        const late = await createAgent('Late joiner')
        expect(existsSync(resolve(skillDir(late, 'linear-triage'), 'SKILL.md'))).toBe(true)
    })

    it('puts the skills back on boot when a folder lost them', async () => {
        const a = await createAgent('Restored')
        await createItem(linearItem([a], { skills: [skill] }))
        await rm(skillsDir(a), { recursive: true, force: true })
        await reconcileVault()
        expect(existsSync(resolve(skillDir(a, 'linear-triage'), 'SKILL.md'))).toBe(true)
        expect(JSON.parse(await readFile(resolve(skillsDir(a), '.vault-skills.json'), 'utf8'))).toEqual({ 'linear-triage': expect.any(String) })
    })

    it('leaves the skill listing free of the marker', async () => {
        const a = await createAgent('Listed skills')
        await createItem(linearItem([a], { skills: [skill] }))
        const res = await send('GET', `/agents/${a}/skills`)
        const body = (await res.json()) as { skills?: Array<{ slug: string }> } | Array<{ slug: string }>
        const slugs = (Array.isArray(body) ? body : (body.skills ?? [])).map(s => s.slug)
        expect(slugs).toEqual(['linear-triage'])
        expect(existsSync(configPath(a))).toBe(true)
    })
})
