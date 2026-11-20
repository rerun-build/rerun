import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cxroutes-'))

const { beforeEach, describe, expect, it, vi } = await import('vitest')

const codexCli = vi.hoisted(() => ({ models: [] as string[] }))
const pendingReads = vi.hoisted(() => new Map<string, Promise<void>>())
vi.mock('../../connections/codex-plan-limits.js', async () => {
    const { recordCliModels } = await import('../../connections/cli-models.js')
    return {
        refreshCodexPlanLimits: async (connection: { id: string } | null) => {
            if (connection) recordCliModels(connection.id, codexCli.models, '0.166.0', false)
        },
        refreshStaleCodexPlanLimits: () => {},
        pendingCodexPlanLimits: (id: string) => pendingReads.get(id),
    }
})
const opencodeLive = vi.hoisted(() => ({ models: null as string[] | null, refreshed: 0 }))
vi.mock('../../connections/opencode-catalog.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../../connections/opencode-catalog.js')>()
    return {
        ...actual,
        refreshOpencodeCatalog: async () => {
            opencodeLive.refreshed += 1
        },
        refreshStaleOpencodeCatalog: () => {},
        liveOpencodeProviderModels: () => (opencodeLive.models ? actual.opencodeProviderModels().filter(model => opencodeLive.models!.includes(model.id)) : null),
    }
})
const providerLive = vi.hoisted(() => ({ models: null as { id: string; label?: string; contextWindow: number | null }[] | null, byId: new Map<string, unknown[]>() }))
vi.mock('../../connections/provider-catalog.js', () => ({
    refreshProviderCatalog: async (connection: { id: string; config: { provider: string } }) => {
        if (providerLive.models && connection.config.provider !== 'claude') providerLive.byId.set(connection.id, providerLive.models)
    },
    refreshStaleProviderCatalogs: () => {},
    providerDiscoveredModels: (id: string) => providerLive.byId.get(id) ?? null,
    providerContextWindow: () => undefined,
    forgetProviderCatalog: (id: string) => providerLive.byId.delete(id),
}))
vi.mock('../../connections/opencode-plan-limits.js', () => ({ refreshOpencodePlanLimits: async () => {}, refreshStaleOpencodePlanLimits: () => {}, forgetOpencodePlanLimitsAttempt: () => {}, pendingOpencodePlanLimits: () => undefined }))
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { DEFAULT_CONNECTION_MODELS, RERUN_CONNECTION_ID } = await import('@moldwright/contracts')
const { connectionRoutes } = await import('./connections.js')
const { createServer } = await import('../server.js')
const { agentDir, agentsDir, boxDefaultPath, configPath, connectionConfigPath, connectionEnvPath, connectionsDir, scheduleFile, schedulesDir } = await import('../../config/paths.js')
const { readEnvFile } = await import('../../lib/env-file.js')
const { ensureMoldwrightConnection } = await import('../../connections/store.js')
const { unloadConnection } = await import('../../connections/registry.js')
const { clearBoxDefault, readBoxDefault } = await import('../../connections/default.js')
const { readSchedule } = await import('../../schedules/loader.js')

type Summary = { id: string; name: string; provider: string; models: string[]; connected: boolean }

async function post(path: string, body: unknown) {
    return connectionRoutes.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

async function patch(path: string, body: unknown) {
    return connectionRoutes.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

async function put(path: string, body: unknown) {
    return connectionRoutes.request(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

async function createClaude(name = 'Claude Clement'): Promise<Summary> {
    const res = await post('/', { name, provider: 'claude', models: ['opus', 'sonnet'], keys: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret' } })
    return (await res.json()) as Summary
}

async function writeAgent(id: string, pair: { connectionId: string | null; provider: string | null; model: string | null }): Promise<void> {
    await mkdir(agentDir(id), { recursive: true })
    await writeFile(configPath(id), JSON.stringify({ name: id, description: '', ...pair, tools: {}, mcpServers: [], selfImprovement: {} }), 'utf8')
}

async function readAgent(id: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(configPath(id), 'utf8')) as Record<string, unknown>
}

async function writeScheduleFile(agentId: string, slug: string, front: Record<string, unknown>): Promise<void> {
    await mkdir(schedulesDir(agentId), { recursive: true })
    const yaml = Object.entries(front)
        .map(([key, value]) => `${key}: ${value === null ? 'null' : String(value)}`)
        .join('\n')
    await writeFile(scheduleFile(agentId, slug), `---\n${yaml}\n---\n\nDo the thing.\n`, 'utf8')
}

beforeEach(async () => {
    codexCli.models = []
    opencodeLive.models = null
    opencodeLive.refreshed = 0
    providerLive.models = null
    providerLive.byId.clear()
    unloadConnection(RERUN_CONNECTION_ID)
    await clearBoxDefault()
    await rm(connectionsDir(), { recursive: true, force: true })
    await rm(agentsDir(), { recursive: true, force: true })
    await ensureMoldwrightConnection()
})

describe('connections API', () => {
    it('creates a connection and never returns its credential', async () => {
        const created = await createClaude()
        expect(created.provider).toBe('claude')
        expect(created.connected).toBe(true)
        expect(JSON.stringify(created)).not.toContain('sk-ant-oat-secret')

        expect(Object.keys(await readEnvFile(connectionEnvPath(created.id)))).toEqual(['CLAUDE_CODE_OAUTH_TOKEN'])
    })

    it('reports a connection with no credential as not connected', async () => {
        const res = await post('/', { name: 'Empty', provider: 'anthropic', models: ['claude-opus-4-8'] })
        expect(((await res.json()) as Summary).connected).toBe(false)
    })

    it('renames and re-curates the models', async () => {
        const created = await createClaude()
        const updated = (await (await patch(`/${created.id}`, { name: 'Team plan', models: ['sonnet'] })).json()) as Summary
        expect(updated.name).toBe('Team plan')
        expect(updated.models).toEqual(['sonnet'])
    })

    it('allows several connections of one provider', async () => {
        await createClaude('Claude Clement')
        await createClaude('Claude Theo')
        const { connections } = (await (await connectionRoutes.request('/')).json()) as { connections: Summary[] }
        expect(connections.filter(c => c.provider === 'claude')).toHaveLength(2)
    })

    it('releases the agents pointing at a deleted connection onto the box default', async () => {
        const created = await createClaude()
        await writeAgent('bound', { connectionId: created.id, provider: 'claude', model: 'opus' })

        const res = await connectionRoutes.request(`/${created.id}`, { method: 'DELETE' })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { deleted: string; released: { agents: { id: string }[] } }
        expect(body.released.agents.map(a => a.id)).toEqual(['bound'])
        expect(await readAgent('bound')).toMatchObject({ connectionId: null, provider: null, model: null })
    })

    it('releases the automations of every agent, at their own slug', async () => {
        const created = await createClaude()
        await writeAgent('owner', { connectionId: null, provider: null, model: null })
        await writeScheduleFile('owner', 'old-slug', { name: 'Renamed digest', connection: created.id, model: 'opus' })

        const res = await connectionRoutes.request(`/${created.id}`, { method: 'DELETE' })
        expect(res.status).toBe(200)
        const body = (await res.json()) as { released: { automations: { agentId: string; kind: string; slug: string }[] } }
        expect(body.released.automations).toEqual([{ agentId: 'owner', kind: 'schedule', slug: 'old-slug' }])
        const schedule = await readSchedule('owner', 'old-slug')
        expect(schedule.connectionId).toBeNull()
        expect(schedule.model).toBeNull()
    })

    it('clears a stale connectionId sitting next to a null model without reporting it', async () => {
        const created = await createClaude()
        await writeAgent('leftover', { connectionId: created.id, provider: 'claude', model: null })

        const res = await connectionRoutes.request(`/${created.id}`, { method: 'DELETE' })
        const body = (await res.json()) as { released: { agents: unknown[] } }
        expect(body.released.agents).toEqual([])
        expect(await readAgent('leftover')).toMatchObject({ connectionId: null, provider: null, model: null })
    })

    it('deletes a connection nothing points at', async () => {
        const created = await createClaude()
        expect((await connectionRoutes.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(200)
        const { connections } = (await (await connectionRoutes.request('/')).json()) as { connections: Summary[] }
        expect(connections.map(c => c.id)).not.toContain(created.id)
    })

    it('protects the Rerun connection', async () => {
        const app = createServer()
        const json = { 'content-type': 'application/json' }
        expect((await app.request(`/connections/${RERUN_CONNECTION_ID}`, { method: 'DELETE' })).status).toBe(400)
        expect((await app.request(`/connections/${RERUN_CONNECTION_ID}`, { method: 'PATCH', headers: json, body: JSON.stringify({ name: 'Free stuff' }) })).status).toBe(400)
        expect((await app.request(`/connections/${RERUN_CONNECTION_ID}`, { method: 'PATCH', headers: json, body: JSON.stringify({ models: ['rerun-max'] }) })).status).toBe(200)
        expect((await app.request(`/connections/${RERUN_CONNECTION_ID}`, { method: 'PATCH', headers: json, body: JSON.stringify({ models: [] }) })).status).toBe(400)
    })

    it('switches the Rerun models back on at boot on a box where they were off', async () => {
        await writeFile(connectionConfigPath(RERUN_CONNECTION_ID), JSON.stringify({ name: 'Rerun', provider: 'rerun', models: [], extraModels: [], createdAt: new Date().toISOString() }), 'utf8')
        unloadConnection(RERUN_CONNECTION_ID)
        await ensureMoldwrightConnection()
        const { connections } = (await (await connectionRoutes.request('/')).json()) as { connections: Summary[] }
        expect(connections.find(c => c.id === RERUN_CONNECTION_ID)?.models).toEqual(['rerun-max', 'rerun-fast', 'rerun-smart'])
    })
})

describe('box default model', () => {
    it('answers null on a box nobody configured', async () => {
        const body = (await (await connectionRoutes.request('/')).json()) as { default: unknown }
        expect(body.default).toBeNull()
    })

    it('sets the pair and echoes it on the next list', async () => {
        const created = await createClaude()
        expect((await put('/default', { connectionId: created.id, model: 'opus' })).status).toBe(200)
        const body = (await (await connectionRoutes.request('/')).json()) as { default: { connectionId: string; model: string } }
        expect(body.default).toEqual({ connectionId: created.id, model: 'opus' })
    })

    it('does not fall through to the connection routes', async () => {
        expect((await put('/default', { connectionId: 'nope', model: 'opus' })).status).toBe(404)
    })

    it('refuses a model the connection does not offer', async () => {
        const created = await createClaude()
        expect((await put('/default', { connectionId: created.id, model: 'haiku' })).status).toBe(400)
    })

    it('clears the default when the connection holding it is deleted', async () => {
        const created = await createClaude()
        await put('/default', { connectionId: created.id, model: 'opus' })
        const res = await connectionRoutes.request(`/${created.id}`, { method: 'DELETE' })
        expect(res.status).toBe(200)
        expect(((await res.json()) as { released: { isBoxDefault: boolean } }).released.isBoxDefault).toBe(true)
        expect(await readBoxDefault()).toBeNull()
    })

    it('repairs the default when its model is switched off', async () => {
        const created = await createClaude()
        await put('/default', { connectionId: created.id, model: 'opus' })
        await patch(`/${created.id}`, { models: ['sonnet'] })
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: 'sonnet' })
    })

    it('adopts the first connected connection', async () => {
        const created = await createClaude()
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: 'opus' })
    })

    it.each([
        ['claude', 'claude-opus-5-5', { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret' }],
        ['codex', 'gpt-6-sol', { CODEX_OAUTH_TOKEN: 'codex-secret' }],
    ] as const)('adopts a %s subscription one step below the top tier', async (provider, model, keys) => {
        const res = await post('/', { name: provider, provider, models: DEFAULT_CONNECTION_MODELS[provider], keys })
        const created = (await res.json()) as Summary
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model })
    })

    it("adopts the first model the account's Codex serves", async () => {
        codexCli.models = ['gpt-6-luna', 'gpt-5.6-sol']
        const res = await post('/', { name: 'codex', provider: 'codex', models: DEFAULT_CONNECTION_MODELS.codex, keys: { CODEX_OAUTH_TOKEN: 'codex-secret' } })
        const created = (await res.json()) as Summary
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: 'gpt-6-luna' })
    })

    it('lists a default moved off a model the account refuses', async () => {
        codexCli.models = ['gpt-6-luna', 'gpt-5.6-terra']
        const created = (await (await post('/', { name: 'codex', provider: 'codex', models: DEFAULT_CONNECTION_MODELS.codex, keys: { CODEX_OAUTH_TOKEN: 'codex-secret' } })).json()) as Summary
        expect((await put('/default', { connectionId: created.id, model: 'gpt-6-sol' })).status).toBe(200)
        const listed = (await (await connectionRoutes.request('/')).json()) as { default: unknown }
        expect(listed.default).toEqual({ connectionId: created.id, model: 'gpt-6-luna' })
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: 'gpt-6-luna' })
    })

    it('still lists when the repair of the default cannot write', async () => {
        codexCli.models = ['gpt-6-luna', 'gpt-5.6-terra']
        const created = (await (await post('/', { name: 'codex', provider: 'codex', models: DEFAULT_CONNECTION_MODELS.codex, keys: { CODEX_OAUTH_TOKEN: 'codex-secret' } })).json()) as Summary
        await put('/default', { connectionId: created.id, model: 'gpt-6-sol' })
        await mkdir(`${boxDefaultPath()}.tmp`)
        const res = await connectionRoutes.request('/')
        expect(res.status).toBe(200)
        expect(((await res.json()) as { default: unknown }).default).toEqual({ connectionId: created.id, model: 'gpt-6-sol' })
    })

    it('adopts DeepSeek V4 Pro on a fresh OpenCode connection, after reading the catalog', async () => {
        const res = await post('/', { name: 'OpenCode', provider: 'opencode', models: DEFAULT_CONNECTION_MODELS.opencode, keys: { OPENCODE_API_KEY: 'oc_sk_secret' } })
        const created = (await res.json()) as Summary & { providerModels: { id: string }[] | null }
        expect(res.status).toBe(201)
        expect(created.connected).toBe(true)
        expect(JSON.stringify(created)).not.toContain('oc_sk_secret')
        expect(created.providerModels?.some(model => model.id === 'console/claude-sonnet-5-5')).toBe(true)
        expect(opencodeLive.refreshed).toBe(1)
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: 'go/deepseek-v4-pro' })
    })

    it('adopts the first model OpenCode still serves', async () => {
        opencodeLive.models = DEFAULT_CONNECTION_MODELS.opencode.filter(id => id !== 'go/deepseek-v4-pro')
        const res = await post('/', { name: 'OpenCode', provider: 'opencode', models: DEFAULT_CONNECTION_MODELS.opencode, keys: { OPENCODE_API_KEY: 'oc_sk_secret' } })
        const created = (await res.json()) as Summary
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: DEFAULT_CONNECTION_MODELS.opencode[1] })
    })

    it('reads the Codex models again when the credential arrives after the connection', async () => {
        const created = (await (await post('/', { name: 'codex', provider: 'codex', models: DEFAULT_CONNECTION_MODELS.codex })).json()) as Summary
        expect(await readBoxDefault()).toBeNull()
        codexCli.models = ['gpt-6-luna']
        await patch(`/${created.id}/keys`, { set: { CODEX_OAUTH_TOKEN: 'codex-secret' } })
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: 'gpt-6-luna' })
    })

    it('leaves a default already set alone', async () => {
        const first = await createClaude('Claude Clement')
        await createClaude('Claude Theo')
        expect(await readBoxDefault()).toEqual({ connectionId: first.id, model: 'opus' })
    })

    it('does not adopt a connection with no credential', async () => {
        await post('/', { name: 'Empty', provider: 'anthropic', models: ['claude-opus-4-8'] })
        expect(await readBoxDefault()).toBeNull()
    })

    it('does not adopt while another connection is already plugged in', async () => {
        await createClaude('Claude Clement')
        await connectionRoutes.request('/default', { method: 'DELETE' })
        await createClaude('Claude Theo')
        expect(await readBoxDefault()).toBeNull()
    })

    it('adopts when the credential arrives after the connection', async () => {
        const created = (await (await post('/', { name: 'Empty', provider: 'anthropic', models: ['claude-opus-4-8'] })).json()) as Summary
        expect(await readBoxDefault()).toBeNull()
        await patch(`/${created.id}/keys`, { set: { ANTHROPIC_API_KEY: 'sk-ant-secret' } })
        expect(await readBoxDefault()).toEqual({ connectionId: created.id, model: 'claude-opus-4-8' })
    })

    it('does not adopt a connection offering no model', async () => {
        await post('/', { name: 'Bare', provider: 'claude', models: [], keys: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret' } })
        expect(await readBoxDefault()).toBeNull()
    })

    it('clears back to nothing', async () => {
        const created = await createClaude()
        await put('/default', { connectionId: created.id, model: 'opus' })
        expect((await connectionRoutes.request('/default', { method: 'DELETE' })).status).toBe(200)
        expect(await readBoxDefault()).toBeNull()
    })
})

describe('plan limits on the list', () => {
    const windows = [{ kind: 'session' as const, label: null, usedPercent: 42, resetsAt: '2026-10-05T15:00:00.000Z' }]

    async function planLimitsOf(id: string): Promise<unknown> {
        const res = await connectionRoutes.request('/')
        const { connections } = (await res.json()) as { connections: (Summary & { planLimits: unknown })[] }
        return connections.find(c => c.id === id)?.planLimits
    }

    it('carries the last reading of a plan, and null before any', async () => {
        const { recordPlanLimits } = await import('../../connections/plan-limits.js')
        const claude = await createClaude()
        expect(await planLimitsOf(claude.id)).toBeNull()

        recordPlanLimits(claude.id, windows)
        expect(await planLimitsOf(claude.id)).toMatchObject({ windows })
    })

    it('survives a config patch but not a change of credential', async () => {
        const { recordPlanLimits } = await import('../../connections/plan-limits.js')
        const claude = await createClaude()
        recordPlanLimits(claude.id, windows)

        await patch(`/${claude.id}`, { models: ['opus'] })
        expect(await planLimitsOf(claude.id)).toMatchObject({ windows })

        await patch(`/${claude.id}/keys`, { set: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-another-account' } })
        expect(await planLimitsOf(claude.id)).toBeNull()
    })

    it('catches up with Claude usage spent outside Moldwright, with no run in between', async () => {
        const { recordPlanLimits } = await import('../../connections/plan-limits.js')
        const { pendingClaudePlanLimits } = await import('../../connections/claude-plan-limits.js')
        const res = await post('/', {
            name: 'Claude signed in',
            provider: 'claude',
            models: ['opus'],
            keys: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-secret', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'sk-ant-ort-secret', CLAUDE_CODE_OAUTH_EXPIRES_AT: String(Date.now() + 24 * 3_600_000) },
        })
        const claude = (await res.json()) as Summary
        vi.useFakeTimers({ now: Date.now() - 20 * 60_000, toFake: ['Date'] })
        recordPlanLimits(claude.id, [{ kind: 'session', label: null, usedPercent: 40, resetsAt: null }])
        vi.useRealTimers()

        const realFetch = globalThis.fetch
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
            String(input) === 'https://api.anthropic.com/api/oauth/usage' ? new Response(JSON.stringify({ five_hour: { utilization: 66, resets_at: null } })) : realFetch(input, init)) as typeof fetch
        try {
            expect(await planLimitsOf(claude.id)).toMatchObject({ windows: [{ kind: 'session', usedPercent: 40 }] })
            await pendingClaudePlanLimits(claude.id)
            expect(await planLimitsOf(claude.id)).toMatchObject({ windows: [{ kind: 'session', usedPercent: 66 }] })
        } finally {
            globalThis.fetch = realFetch
        }
    })

    it('waits for the read a run left under way, so the list carries it', async () => {
        const { recordPlanLimits } = await import('../../connections/plan-limits.js')
        const claude = await createClaude()
        pendingReads.set(
            claude.id,
            new Promise<void>(resolve =>
                setTimeout(() => {
                    recordPlanLimits(claude.id, windows)
                    resolve()
                }, 20)
            )
        )
        try {
            expect(await planLimitsOf(claude.id)).toMatchObject({ windows })
        } finally {
            pendingReads.delete(claude.id)
        }
    })

    it('answers with the reading it has when that read hangs', async () => {
        const claude = await createClaude()
        pendingReads.set(claude.id, new Promise<void>(() => {}))
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            let answered = false
            const listed = planLimitsOf(claude.id).finally(() => {
                answered = true
            })
            const deadline = Date.now() + 4_000
            while (!answered && Date.now() < deadline) {
                await new Promise<void>(resolve => setImmediate(resolve))
                await vi.advanceTimersByTimeAsync(1_000)
            }
            expect(await listed).toBeNull()
        } finally {
            pendingReads.delete(claude.id)
            vi.useRealTimers()
        }
    })
})

describe('live provider model lists', () => {
    it('lists what the provider API offers, leaves new models off, and lets one be turned on and served', async () => {
        providerLive.models = [{ id: 'google/gemini-4-carbon', label: 'Google: Gemini 4 Carbon', contextWindow: 2_000_000 }]
        const res = await post('/', { name: 'Router', provider: 'openrouter', models: ['anthropic/claude-sonnet-5.5'], keys: { OPENROUTER_API_KEY: 'sk-or-secret' } })
        const created = (await res.json()) as Summary & { discoveredModels: { id: string }[] | null }
        expect(created.discoveredModels?.map(model => model.id)).toEqual(['google/gemini-4-carbon'])
        expect(created.models).toEqual(['anthropic/claude-sonnet-5.5'])
        expect((await put('/default', { connectionId: created.id, model: 'google/gemini-4-carbon' })).status).toBe(400)

        await patch(`/${created.id}`, { models: ['anthropic/claude-sonnet-5.5', 'google/gemini-4-carbon'] })
        expect((await put('/default', { connectionId: created.id, model: 'google/gemini-4-carbon' })).status).toBe(200)
    })

    it('carries no live list while the read has not succeeded, so the fixed list stands in', async () => {
        const created = (await (await post('/', { name: 'OpenAI', provider: 'openai', keys: { OPENAI_API_KEY: 'sk-openai' } })).json()) as Summary
        const { connections } = (await (await connectionRoutes.request('/')).json()) as { connections: (Summary & { discoveredModels: unknown })[] }
        expect(connections.find(c => c.id === created.id)?.discoveredModels).toBeNull()
    })
})
