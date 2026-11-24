import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-index-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { buildMcpIndex, describeConnectorState } = await import('./mcp-index.js')
const { saveToken } = await import('./mcp-auth.js')
const { createVaultItem } = await import('../vault/store.js')
const { saveVaultToken } = await import('../vault/tokens.js')
const { agentDir, configPath, mcpDir, mcpTokenPath, workspaceDir } = await import('../config/paths.js')

type Server = { name: string; transport?: 'stdio' | 'sse' | 'http'; command?: string; url?: string; args: string[]; env: Record<string, string>; headers: Record<string, string> }

function agentWith(id: string, servers: Array<Partial<Server> & { name: string }>, suggestService = true, allowToolInstall = true) {
    const selfImprovement = { enabled: true, allowToolInstall, allowSoulEdit: true, autoMemory: true }
    return { id, env: {}, config: { tools: { suggestService }, selfImprovement, mcpServers: servers.map(s => ({ args: [], env: {}, headers: {}, ...s })) } } as any
}

async function writeRegistry(id: string, services: Record<string, unknown>): Promise<void> {
    await mkdir(resolve(workspaceDir(id), '.rerun'), { recursive: true })
    await writeFile(resolve(workspaceDir(id), '.rerun/services.json'), JSON.stringify({ services }), 'utf8')
}

const HUB_HEADERS = { 'x-rerun-key': '${RERUN_API_KEY}', 'x-rerun-agent': 'agent' }

describe('buildMcpIndex', () => {
    it('is empty for an agent without MCP servers', async () => {
        expect(await buildMcpIndex(agentWith('idx-none', []))).toBe('')
    })

    it('lists every server with its transport and how it authenticates', async () => {
        await saveToken('idx-agent', 'oauthed', { accessToken: 't', obtainedAt: 1 })
        const index = await buildMcpIndex(
            agentWith('idx-agent', [
                { name: 'headered', url: 'https://h.example/mcp', headers: { Authorization: 'Bearer x' } },
                { name: 'oauthed', url: 'https://o.example/sse' },
                { name: 'local', command: 'npx' },
            ]),
        )
        expect(index).toMatch(/^These MCP servers are already configured\./)
        expect(index).toContain('mcp_status')
        expect(index.split('\n\n')[1].split('\n')).toEqual([
            '- headered (http): authenticated via request headers',
            '- oauthed (sse): authenticated (OAuth)',
            '- local (stdio): local command',
        ])
    })

    it('sends a server without a sign-in to the Connect card, or to the Apps panel when the agent has no card', async () => {
        const servers = [{ name: 'getmcp', url: 'https://g.example/mcp' }]
        expect(await buildMcpIndex(agentWith('idx-signin', servers))).toContain('- getmcp (http): not signed in — if its tools answer that sign-in is required, call request_mcp_sign_in with its name and end your turn')
        expect(await buildMcpIndex(agentWith('idx-signin-off', servers, true, false))).toContain('- getmcp (http): not signed in — if its tools answer that sign-in is required, ask the user to connect it from the Apps panel of this coworker')
    })

    it('sends a Vault server without a sign-in to the Vault, whose sign-in the Connect card cannot run', async () => {
        const url = 'https://v.example/mcp'
        await mkdir(agentDir('idx-vault'), { recursive: true })
        await writeFile(configPath('idx-vault'), JSON.stringify({ name: 'idx-vault' }), 'utf8')
        const item = await createVaultItem({ kind: 'mcp', name: 'Docs', agentIds: ['idx-vault'], mcpServers: [{ name: 'docs', url }], oauth: { serverName: 'docs', url } })
        const agent = agentWith('idx-vault', [{ name: 'own', url: 'https://o.example/mcp' }])
        const lines = (await buildMcpIndex(agent)).split('\n\n')[1].split('\n')
        expect(lines).toEqual([
            "- docs (http): not signed in — if its tools answer that sign-in is required, ask the user to sign in to it from the workspace's Vault (workspace menu, Vault)",
            '- own (http): not signed in — if its tools answer that sign-in is required, call request_mcp_sign_in with its name and end your turn',
        ])

        await saveVaultToken(item.id, 'docs', { accessToken: 'at', obtainedAt: Date.now() })
        expect(await buildMcpIndex(agent)).toContain('- docs (http): authenticated (OAuth)')
    })

    it('does not send a server dialed with a key in its url to the Connect card', async () => {
        const index = await buildMcpIndex(agentWith('idx-keyed-url', [{ name: 'keyed', url: 'https://k.example/mcp?key=${KEY}' }]))
        expect(index).toContain('- keyed (http): authenticated with a key in its url')
        expect(index).not.toContain('request_mcp_sign_in')
    })

    it('gives the tool name format of the model the run is on', async () => {
        const agent = agentWith('idx-format', [{ name: 'local', command: 'npx' }])
        expect(await buildMcpIndex(agent, 'claude')).toContain('Their tools are loaded as `mcp__<name>__<tool>`.')
        expect(await buildMcpIndex(agent, 'codex')).toContain('Their tools are loaded as `mcp__<name>__<tool>`.')
        expect(await buildMcpIndex(agent, 'rerun')).toContain('Their tools are loaded as `<name>_<tool>`.')
    })

    it('tells a run that holds its MCP tools back how to find and run them, with what each server holds', async () => {
        const agent = agentWith('idx-deferred', [
            { name: 'linear', url: 'https://l.example/mcp', headers: { Authorization: 'Bearer x' } },
            { name: 'down', url: 'https://d.example/mcp', headers: { Authorization: 'Bearer x' } },
        ])
        const tool = (name: string) => ({ name: `linear_${name}`, server: 'linear', tool: name, description: '', inputSchema: { type: 'object' as const } })
        const index = await buildMcpIndex(agent, 'rerun', [tool('list_issues'), tool('create_issue')])
        expect(index).toContain('Their tools are named `<name>_<tool>` and are not in your tool list: call mcp_search')
        expect(index).toContain('then run one with mcp_call.')
        expect(index).not.toContain('Their tools are loaded as')
        expect(index.split('\n\n')[1].split('\n')).toEqual(['- linear (http): authenticated via request headers, 2 tools', '- down (http): authenticated via request headers, 0 tools'])
    })

    it('treats an unreadable token or an unusable server name as not signed in', async () => {
        await mkdir(mcpDir('idx-broken'), { recursive: true })
        await writeFile(mcpTokenPath('idx-broken', 'corrupt'), '{', 'utf8')
        const index = await buildMcpIndex(agentWith('idx-broken', [{ name: 'corrupt', url: 'https://c.example/mcp' }, { name: 'bad/name', url: 'https://b.example/mcp' }]))
        expect(index).toContain('- corrupt (http): not signed in')
        expect(index).toContain('- bad/name (http): not signed in')
    })

    it('takes a catalog app server status from the registry, not from its hub headers', async () => {
        await writeRegistry('idx-apps', {
            gmail: { status: 'needs_auth', mcpServers: ['gmail'], composio: { toolkit: 'gmail', serverName: 'gmail' } },
            outlook: { status: 'active', mcpServers: ['outlook'], composio: { toolkit: 'outlook', serverName: 'outlook', connectedAccountId: 'ca_1' } },
            stripe: { status: 'needs_config', mcpServers: [] },
            legacy: { status: 'needs_auth', toolNames: ['legacy-server'] },
        })
        const index = await buildMcpIndex(
            agentWith('idx-apps', [
                { name: 'gmail', url: 'https://hub.example/api/mcp/composio/gmail', headers: HUB_HEADERS },
                { name: 'outlook', url: 'https://hub.example/api/mcp/composio/outlook', headers: HUB_HEADERS },
                { name: 'legacy-server', url: 'https://l.example/mcp' },
                { name: 'mine', url: 'https://m.example/mcp', headers: { Authorization: 'Bearer x' } },
            ]),
        )
        expect(index.split('\n\n')[1].split('\n')).toEqual([
            '- gmail (http): not connected yet (app "gmail")',
            '- outlook (http): connected (app "outlook")',
            '- legacy-server (http): not connected yet (app "legacy")',
            '- mine (http): authenticated via request headers',
        ])
        expect(index).toContain('never tell the user that app is connected')
        expect(index).toContain('call suggest_service with its app slug')
    })

    it('points to the Apps panel when the agent cannot suggest a service', async () => {
        await writeRegistry('idx-no-suggest', { gmail: { status: 'needs_auth', mcpServers: ['gmail'] } })
        const index = await buildMcpIndex(agentWith('idx-no-suggest', [{ name: 'gmail', url: 'https://hub.example/api/mcp/composio/gmail', headers: HUB_HEADERS }], false))
        expect(index).toContain('Apps panel')
        expect(index).not.toContain('suggest_service')
    })

    it('says nothing about apps waiting for a connection when every app is connected', async () => {
        await writeRegistry('idx-all-active', { gmail: { status: 'active', mcpServers: ['gmail'] }, notion: { status: 'needs_auth', mcpServers: ['notion'] } })
        const index = await buildMcpIndex(agentWith('idx-all-active', [{ name: 'gmail', url: 'https://hub.example/api/mcp/composio/gmail', headers: HUB_HEADERS }]))
        expect(index).toContain('- gmail (http): connected (app "gmail")')
        expect(index).not.toContain('not connected yet')
    })

    it('names the account of an app the agent holds several of, and which one is the default', async () => {
        await writeRegistry('idx-instances', {
            gmail: { status: 'active', mcpServers: ['gmail'] },
            'gmail@k3x9ab': { status: 'needs_auth', instanceId: 'k3x9ab', label: 'support@acme.com', mcpServers: ['gmail-k3x9ab'] },
            notion: { status: 'active', label: 'Acme wiki', mcpServers: ['notion'] },
        })
        const index = await buildMcpIndex(
            agentWith('idx-instances', [
                { name: 'gmail', url: 'https://hub.example/api/mcp/composio/gmail', headers: HUB_HEADERS },
                { name: 'gmail-k3x9ab', url: 'https://hub.example/api/mcp/composio/gmail-k3x9ab', headers: HUB_HEADERS },
                { name: 'notion', url: 'https://hub.example/api/mcp/notion', headers: HUB_HEADERS },
            ]),
        )
        expect(index.split('\n\n')[1].split('\n')).toEqual([
            '- gmail (http): connected (app "gmail", default account)',
            '- gmail-k3x9ab (http): not connected yet (app "gmail", account support@acme.com)',
            '- notion (http): connected (app "notion", account Acme wiki)',
        ])
    })
})

describe('describeConnectorState', () => {
    const base = { key: 'gmail', slug: 'gmail', status: 'active', isDefault: true }
    const second = { key: 'gmail@k3x9ab', slug: 'gmail', label: 'Gmail 2', status: 'active', isDefault: false }

    it('names only the app for a lone account without a label', () => {
        expect(describeConnectorState(base, new Map([['gmail', base]]))).toBe('app "gmail"')
    })

    it('marks the base account as the default once a second one exists', () => {
        const states = new Map([
            ['gmail', base],
            ['gmail-extra', base],
            ['gmail-k3x9ab', second],
        ])
        expect(describeConnectorState(base, states)).toBe('app "gmail", default account')
        expect(describeConnectorState(second, states)).toBe('app "gmail", account Gmail 2')
    })

    it('does not call the base account the default when the other servers are its own', () => {
        expect(describeConnectorState({ ...base, label: 'me@acme.com' }, new Map([['gmail', base], ['gmail-extra', base]]))).toBe('app "gmail", account me@acme.com')
    })
})
