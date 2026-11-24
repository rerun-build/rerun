import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-self-mcp-'))
process.env.RERUN_API_KEY = ''

type Probe = { ok: boolean; transport: string; toolNames: string[]; error?: string }

const mocks = vi.hoisted(() => ({
    probes: new Map<string, Probe>(),
    probed: [] as Array<{ agentId: string; name: string; env: Record<string, string> }>,
    auth: {
        discoverDeviceAuth: vi.fn(),
        startDeviceFlow: vi.fn(),
        pollDeviceToken: vi.fn(),
        savePending: vi.fn(),
        loadPending: vi.fn(),
        clearPending: vi.fn(),
        saveToken: vi.fn(),
    },
}))

vi.mock('../mcp.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../mcp.js')>()),
    probeMcp: async (agentId: string, server: { name: string }, env: Record<string, string>) => {
        mocks.probed.push({ agentId, name: server.name, env })
        return mocks.probes.get(server.name) ?? { ok: true, transport: 'http', toolNames: [] }
    },
}))

vi.mock('../mcp-auth.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../mcp-auth.js')>()),
    ...mocks.auth,
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { selfTools } = await import('./self.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { getAgent } = await import('../../agents/registry.js')
const { agentDir, configPath, soulPath, workspaceDir } = await import('../../config/paths.js')
const { createVaultItem, deleteVaultItem } = await import('../../vault/store.js')

const id = 'self-mcp-agent'
const agentEnv = { LINEAR_KEY: 'k' }

function ctxWith(selfImprovement: Record<string, boolean> = {}) {
    return { agent: { id, env: agentEnv, config: agentConfigSchema.parse({ name: 'self', selfImprovement }) } } as any
}

async function call(name: string, args: Record<string, unknown>, ctx = ctxWith()): Promise<string> {
    return (await (selfTools(ctx)[name] as any).execute(args, { toolCallId: 'c', messages: [] })) as string
}

async function storedServers() {
    return agentConfigSchema.parse(JSON.parse(await readFile(configPath(id), 'utf8'))).mcpServers
}

async function seedServers(servers: Array<Record<string, unknown>>) {
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'self', mcpServers: servers }))
}

beforeEach(async () => {
    mocks.probes.clear()
    mocks.probed.length = 0
    for (const fn of Object.values(mocks.auth)) fn.mockReset()
    await mkdir(agentDir(id), { recursive: true })
    await writeFile(soulPath(id), 'Old soul\n', 'utf8')
    await seedServers([])
})

describe('selfTools gating', () => {
    it('leaves soul_update out when soul edits are off', () => {
        expect(selfTools(ctxWith({ allowSoulEdit: false })).soul_update).toBeUndefined()
        expect(selfTools(ctxWith()).soul_update).toBeDefined()
    })

    it('leaves every MCP tool out when tool installs are off', () => {
        const names = Object.keys(selfTools(ctxWith({ allowToolInstall: false })))
        expect(names.sort()).toEqual(['soul_update', 'verbosity_set'])
    })

    it('offers the sign-in card with the MCP tools', () => {
        expect(selfTools(ctxWith()).request_mcp_sign_in).toBeDefined()
    })
})

describe('soul_update', () => {
    it('writes the trimmed soul and reloads the agent', async () => {
        await getAgent(id)
        const out = await call('soul_update', { soul: '  # New soul\nI help.  \n\n', reason: 'The user renamed me.' })
        expect(out).toBe('Soul updated (The user renamed me.). It takes effect from your next message onward.')
        expect(await readFile(soulPath(id), 'utf8')).toBe('# New soul\nI help.\n')
        expect((await getAgent(id)).soul).toBe('# New soul\nI help.\n')
    })
})

describe('mcp_register', () => {
    const register = (args: Record<string, unknown>) => call('mcp_register', { args: [], headers: {}, ...args })

    it('refuses the name of the builtin bridge without probing', async () => {
        const out = await register({ name: 'rerun', url: 'https://x.example/mcp' })
        expect(out).toMatch(/"rerun" is reserved/)
        expect(out).toMatch(/\nNothing was saved\.$/)
        expect(mocks.probed).toHaveLength(0)
        expect(await storedServers()).toEqual([])
    })

    it('refuses a name providers would reject', async () => {
        const out = await register({ name: 'my server', url: 'https://x.example/mcp' })
        expect(out).toContain('MCP server name "my server" is invalid')
        expect(out).toMatch(/\nNothing was saved\.$/)
        expect(mocks.probed).toHaveLength(0)
    })

    it('saves nothing when the server cannot be reached', async () => {
        mocks.probes.set('linear', { ok: false, transport: 'sse', toolNames: [], error: 'ECONNREFUSED' })
        const out = await register({ name: 'linear', url: 'https://l.example/sse' })
        expect(out).toBe('Could not connect to MCP server "linear" via sse: ECONNREFUSED\nNothing was saved. Fix the url, transport, or auth headers and try again.')
        expect(await storedServers()).toEqual([])
    })

    it('saves a server that answers 401 and hands the sign-in to request_mcp_sign_in', async () => {
        mocks.probes.set('linear', { ok: false, transport: 'http', toolNames: [], error: 'HTTP 401' })
        const out = await register({ name: 'linear', url: 'https://l.example/mcp' })
        expect(out).toBe('Registered MCP server "linear" (http), but it requires sign-in. Call request_mcp_sign_in with name "linear" now, in the same message, and end your turn: the user gets a Connect card and you continue from their reply. Do not describe the sign-in steps yourself. Only if they skip it or say they cannot sign in, call mcp_login with name "linear".')
        expect((await storedServers()).map(s => s.name)).toEqual(['linear'])
    })

    it('saves nothing when the server turns down the key it was given', async () => {
        mocks.probes.set('seranking', { ok: false, transport: 'http', toolNames: [], error: 'API key provided via X-Api-Key failed validation. (HTTP 401)' })
        const out = await register({ name: 'seranking', url: 'https://api.seranking.com/mcp', headers: { 'X-Api-Key': '${SERANKING_API_KEY}' } })
        expect(out).toBe('Could not connect to MCP server "seranking" via http: the server rejected the credentials: API key provided via X-Api-Key failed validation. (HTTP 401)\nNothing was saved. Ask the user for a valid value with request_secret, then register it again.')
        expect(await storedServers()).toEqual([])
    })

    it('treats a 401 on a url carrying a variable as a turned-down key', async () => {
        mocks.probes.set('tool', { ok: false, transport: 'http', toolNames: [], error: 'HTTP 401' })
        const out = await register({ name: 'tool', url: 'https://t.example/mcp?key=${TOOL_KEY}' })
        expect(out).toMatch(/the server rejected the credentials/)
        expect(await storedServers()).toEqual([])
    })

    it('treats an auth error from a stdio server carrying a variable in its args as a turned-down key', async () => {
        mocks.probes.set('cli', { ok: false, transport: 'stdio', toolNames: [], error: 'Unauthorized: invalid token' })
        const out = await register({ name: 'cli', command: 'npx', args: ['some-mcp', '--token', '${TOOL_KEY}'] })
        expect(out).toMatch(/the server rejected the credentials/)
        expect(await storedServers()).toEqual([])
    })

    it('probes with the agent env, saves the server and lists its tools', async () => {
        mocks.probes.set('linear', { ok: true, transport: 'http', toolNames: ['search', 'create'] })
        const out = await register({ name: 'linear', url: 'https://l.example/mcp', headers: { Authorization: 'Bearer ${LINEAR_KEY}' } })
        expect(out).toBe('Connected and registered MCP server "linear" (http). 2 tools now available: linear_search, linear_create. They are active from your next message onward, no restart needed.')
        expect(mocks.probed).toEqual([{ agentId: id, name: 'linear', env: agentEnv }])
        expect(await storedServers()).toEqual([{ name: 'linear', url: 'https://l.example/mcp', args: [], env: {}, headers: { Authorization: 'Bearer ${LINEAR_KEY}' } }])
        expect((await getAgent(id)).config.mcpServers.map(s => s.name)).toEqual(['linear'])
    })

    it('replaces a server registered under the same name', async () => {
        await seedServers([{ name: 'linear', url: 'https://old.example/mcp' }, { name: 'other', command: 'npx' }])
        await register({ name: 'linear', url: 'https://new.example/mcp' })
        expect((await storedServers()).map(s => [s.name, s.url])).toEqual([
            ['linear', 'https://new.example/mcp'],
            ['other', undefined],
        ])
    })
})

describe('mcp_login', () => {
    it('says an unknown server must be registered first', async () => {
        expect(await call('mcp_login', { name: 'ghost' })).toBe('No MCP server named "ghost" is registered. Register it first with mcp_register.')
    })

    it('refuses a stdio server', async () => {
        await seedServers([{ name: 'local', command: 'npx' }])
        expect(await call('mcp_login', { name: 'local' })).toBe('Server "local" is stdio-based and does not use OAuth sign-in.')
    })

    it('starts the device flow, stores it as pending and hands out the link', async () => {
        await seedServers([{ name: 'linear', url: 'https://l.example/mcp' }])
        const endpoints = { deviceEndpoint: 'https://a/authorize', tokenEndpoint: 'https://a/token' }
        const start = { deviceCode: 'dc', verificationUri: 'https://a/verify', interval: 5, expiresIn: 610 }
        mocks.auth.discoverDeviceAuth.mockResolvedValue(endpoints)
        mocks.auth.startDeviceFlow.mockResolvedValue(start)

        const out = await call('mcp_login', { name: 'linear' })

        expect(mocks.auth.discoverDeviceAuth).toHaveBeenCalledWith('https://l.example/mcp')
        expect(mocks.auth.savePending).toHaveBeenCalledWith(id, 'linear', { auth: endpoints, start, startedAt: expect.any(Number) })
        expect(out).toContain('open this URL and sign in to "linear":\nhttps://a/verify\n')
        expect(out).toContain('valid for about 10 minutes')
        expect(out).toContain('call mcp_login_complete with name "linear"')
    })

    it('reports a server that offers no device sign-in', async () => {
        await seedServers([{ name: 'linear', url: 'https://l.example/mcp' }])
        mocks.auth.discoverDeviceAuth.mockRejectedValue(new Error('this MCP server does not advertise a device-code OAuth flow'))
        expect(await call('mcp_login', { name: 'linear' })).toBe('Could not start sign-in for "linear": this MCP server does not advertise a device-code OAuth flow. Unless the user already skipped its Connect card, call request_mcp_sign_in with name "linear" and end your turn. If they did, tell them it can only be connected from that card or from the Apps panel of this coworker.')
        expect(mocks.auth.savePending).not.toHaveBeenCalled()
    })
})

describe('mcp_login_complete', () => {
    const pending = { auth: { deviceEndpoint: 'd', tokenEndpoint: 't' }, start: { deviceCode: 'dc', verificationUri: 'u', interval: 5, expiresIn: 900 }, startedAt: 1 }
    const token = { accessToken: 'tok', obtainedAt: 1 }

    it('asks for mcp_login first when nothing is pending', async () => {
        mocks.auth.loadPending.mockResolvedValue(null)
        expect(await call('mcp_login_complete', { name: 'linear' })).toBe('No pending sign-in for "linear". Call mcp_login first.')
    })

    it('polls for two minutes at most, stores the token, clears the pending sign-in and lists the tools', async () => {
        await seedServers([{ name: 'linear', url: 'https://l.example/mcp' }])
        mocks.auth.loadPending.mockResolvedValue(pending)
        mocks.auth.pollDeviceToken.mockResolvedValue(token)
        mocks.probes.set('linear', { ok: true, transport: 'http', toolNames: ['search'] })

        const out = await call('mcp_login_complete', { name: 'linear' })

        expect(mocks.auth.pollDeviceToken).toHaveBeenCalledWith(pending.auth, pending.start, { maxWaitMs: 120_000 })
        expect(mocks.auth.saveToken).toHaveBeenCalledWith(id, 'linear', token)
        expect(mocks.auth.clearPending).toHaveBeenCalledWith(id, 'linear')
        expect(out).toBe('Signed in to "linear". 1 tools now available: linear_search. Active from your next message onward.')
    })

    it('says when the connection still fails after sign-in', async () => {
        await seedServers([{ name: 'linear', url: 'https://l.example/mcp' }])
        mocks.auth.loadPending.mockResolvedValue(pending)
        mocks.auth.pollDeviceToken.mockResolvedValue(token)
        mocks.probes.set('linear', { ok: false, transport: 'http', toolNames: [], error: 'HTTP 403' })
        expect(await call('mcp_login_complete', { name: 'linear' })).toBe('Signed in to "linear", but the connection still failed: HTTP 403')
    })

    it('says when the server was removed meanwhile', async () => {
        mocks.auth.loadPending.mockResolvedValue(pending)
        mocks.auth.pollDeviceToken.mockResolvedValue(token)
        expect(await call('mcp_login_complete', { name: 'linear' })).toBe('Signed in to "linear", but it is no longer registered.')
        expect(mocks.auth.saveToken).toHaveBeenCalled()
    })

    it('keeps the pending sign-in when the user has not finished', async () => {
        mocks.auth.loadPending.mockResolvedValue(pending)
        mocks.auth.pollDeviceToken.mockRejectedValue(new Error('still waiting for sign-in — finish opening the link, then try again'))
        expect(await call('mcp_login_complete', { name: 'linear' })).toBe('Sign-in not finished for "linear": still waiting for sign-in — finish opening the link, then try again')
        expect(mocks.auth.saveToken).not.toHaveBeenCalled()
        expect(mocks.auth.clearPending).not.toHaveBeenCalled()
    })
})

const VAULT_NOTE = (name: string) => `"${name}" comes from the workspace's Vault and is shared with other coworkers. Ask the user to sign in to it from the Vault (workspace menu, Vault); you cannot sign it in yourself.`

describe('request_mcp_sign_in', () => {
    it('shows its card for a server of the coworker', async () => {
        await seedServers([{ name: 'getmcp', url: 'https://g.example/mcp' }])
        expect(await call('request_mcp_sign_in', { name: 'getmcp' })).toMatchObject({ status: 'delivered' })
    })

    it('refuses a server of the Vault, which its card could not sign in', async () => {
        const item = await createVaultItem({ kind: 'mcp', name: 'Docs', agentIds: [id], mcpServers: [{ name: 'docs', url: 'https://d.example/mcp' }] })
        try {
            await expect(call('request_mcp_sign_in', { name: 'docs' })).rejects.toThrow(VAULT_NOTE('docs'))
            expect(await call('mcp_login', { name: 'docs' })).toBe(VAULT_NOTE('docs'))
        } finally {
            await deleteVaultItem(item.id)
        }
        expect(await call('request_mcp_sign_in', { name: 'docs' })).toMatchObject({ status: 'delivered' })
    })
})

describe('mcp_status', () => {
    it('says when no server is registered', async () => {
        expect(await call('mcp_status', {})).toBe('No MCP servers registered.')
    })

    it('probes every server and reports each one on its own line', async () => {
        await seedServers([{ name: 'linear', url: 'https://l.example/mcp' }, { name: 'local', command: 'npx' }])
        mocks.probes.set('linear', { ok: true, transport: 'http', toolNames: ['a', 'b'] })
        mocks.probes.set('local', { ok: false, transport: 'stdio', toolNames: [], error: 'spawn npx ENOENT' })
        expect((await call('mcp_status', {})).split('\n')).toEqual(['connected linear (http): 2 tools — linear_a, linear_b', 'failed local (stdio): spawn npx ENOENT'])
        expect(mocks.probed.every(p => p.env === agentEnv)).toBe(true)
    })

    it('sends a server that asks for sign-in to the Connect card', async () => {
        await seedServers([{ name: 'getmcp', url: 'https://g.example/mcp' }, { name: 'keyed', url: 'https://k.example/mcp', headers: { Authorization: 'Bearer ${KEY}' } }])
        mocks.probes.set('getmcp', { ok: false, transport: 'http', toolNames: [], error: 'Streamable HTTP error: Error POSTing to endpoint: Missing OAuth access token (HTTP 401)' })
        mocks.probes.set('keyed', { ok: false, transport: 'http', toolNames: [], error: 'Unauthorized (HTTP 401)' })
        expect((await call('mcp_status', {})).split('\n')).toEqual([
            'needs sign-in getmcp (http): call request_mcp_sign_in with name "getmcp" and end your turn',
            'failed keyed (http): Unauthorized (HTTP 401)',
        ])
    })

    it('sends a server of the Vault that asks for sign-in to the Vault, unless a key of its own is turned down', async () => {
        const open = await createVaultItem({ kind: 'mcp', name: 'Docs', agentIds: [id], mcpServers: [{ name: 'docs', url: 'https://d.example/mcp' }] })
        const keyed = await createVaultItem({ kind: 'mcp', name: 'Keyed', agentIds: [id], env: { VAULT_KEY: 'k' }, mcpServers: [{ name: 'keyed', url: 'https://k.example/mcp', headers: { Authorization: 'Bearer ${VAULT_KEY}' } }] })
        try {
            for (const name of ['docs', 'keyed']) mocks.probes.set(name, { ok: false, transport: 'http', toolNames: [], error: 'Unauthorized (HTTP 401)' })
            expect((await call('mcp_status', {})).split('\n')).toEqual([`needs sign-in docs (http): ${VAULT_NOTE('docs')}`, 'failed keyed (http): Unauthorized (HTTP 401)'])
        } finally {
            await deleteVaultItem(open.id)
            await deleteVaultItem(keyed.id)
        }
    })

    it('names the tools the way the CLI of the run shows them', async () => {
        await seedServers([{ name: 'dataforseo', command: 'npx' }])
        mocks.probes.set('dataforseo', { ok: true, transport: 'stdio', toolNames: ['api_request'] })
        expect(await call('mcp_status', {}, { ...ctxWith(), provider: 'claude' })).toBe('connected dataforseo (stdio): 1 tools — mcp__dataforseo__api_request')
        expect(await call('mcp_status', {}, { ...ctxWith(), provider: 'rerun' })).toBe('connected dataforseo (stdio): 1 tools — dataforseo_api_request')
    })

    it('reports an app the user has not connected yet without probing it', async () => {
        const registryDir = resolve(workspaceDir(id), '.rerun')
        await mkdir(registryDir, { recursive: true })
        await writeFile(resolve(registryDir, 'services.json'), JSON.stringify({ services: { gmail: { status: 'needs_auth', mcpServers: ['gmail'] }, linear: { status: 'active', mcpServers: ['linear'] } } }), 'utf8')
        try {
            await seedServers([{ name: 'gmail', url: 'https://hub.example/api/mcp/composio/gmail' }, { name: 'linear', url: 'https://l.example/mcp' }])
            mocks.probes.set('linear', { ok: true, transport: 'http', toolNames: ['a'] })
            expect((await call('mcp_status', {})).split('\n')).toEqual([
                'not connected yet gmail: app "gmail" is waiting for the user to connect it (suggest_service), every call to its tools fails until then',
                'connected linear (http): 1 tools — linear_a',
            ])
            expect(mocks.probed.map(p => p.name)).toEqual(['linear'])
        } finally {
            await rm(registryDir, { recursive: true, force: true })
        }
    })

    it('names the account of an app the user has not connected yet when the agent holds several', async () => {
        const registryDir = resolve(workspaceDir(id), '.rerun')
        await mkdir(registryDir, { recursive: true })
        await writeFile(
            resolve(registryDir, 'services.json'),
            JSON.stringify({
                services: {
                    gmail: { status: 'needs_auth', mcpServers: ['gmail'] },
                    'gmail@k3x9ab': { status: 'needs_auth', instanceId: 'k3x9ab', label: 'support@acme.com', mcpServers: ['gmail-k3x9ab'] },
                },
            }),
            'utf8',
        )
        try {
            await seedServers([
                { name: 'gmail', url: 'https://hub.example/api/mcp/composio/gmail' },
                { name: 'gmail-k3x9ab', url: 'https://hub.example/api/mcp/composio/gmail-k3x9ab' },
            ])
            expect((await call('mcp_status', {})).split('\n')).toEqual([
                'not connected yet gmail: app "gmail", default account is waiting for the user to connect it (suggest_service), every call to its tools fails until then',
                'not connected yet gmail-k3x9ab: app "gmail", account support@acme.com is waiting for the user to connect it (suggest_service), every call to its tools fails until then',
            ])
            expect(mocks.probed).toHaveLength(0)
        } finally {
            await rm(registryDir, { recursive: true, force: true })
        }
    })
})
