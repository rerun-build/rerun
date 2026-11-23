import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileService, decompileService } from './compiler'
import { serviceManifestSchema } from './manifest'
import { deleteSkill, patchMcpServers, updateAgentKeys } from '@/lib/engine/client'
import { readRegistry, upsertRegistryEntry } from './registry'

vi.mock('@/app/api/_services/chat.service', () => ({
    resolveAgentTarget: vi.fn(async () => ({ conn: {}, engineAgentId: 'engine-agent' })),
}))
vi.mock('@/lib/engine/client', () => ({
    createSkill: vi.fn(async () => ({ slug: 'skill' })),
    deleteMcpToken: vi.fn(),
    deleteSkill: vi.fn(async () => {}),
    listSkills: vi.fn(async () => []),
    patchMcpServers: vi.fn(),
    updateAgentKeys: vi.fn(),
    updateSkill: vi.fn(),
}))
vi.mock('@/lib/composio/client', () => ({ deleteConnectedAccount: vi.fn() }))
vi.mock('./registry', async importOriginal => {
    const actual = await importOriginal<typeof import('./registry')>()
    return { ...actual, upsertRegistryEntry: vi.fn(), readRegistry: vi.fn(async () => ({ services: {} })), registryFootprint: vi.fn(actual.registryFootprint) }
})

const manifest = serviceManifestSchema.parse({
    name: 'Atlassian',
    slug: 'atlassian',
    summary: 'Jira and Confluence.',
    description: 'Jira and Confluence.',
    category: 'dev',
    authMethods: [
        {
            id: 'api-token',
            kind: 'key',
            label: 'API token',
            inputs: [
                { key: 'ATLASSIAN_EMAIL', label: 'Atlassian email', type: 'text', required: true, secret: false },
                { key: 'ATLASSIAN_API_TOKEN', label: 'Atlassian API token', type: 'password', required: true, secret: true },
            ],
            mcpServers: [
                {
                    name: 'atlassian',
                    transport: 'http',
                    url: 'https://mcp.atlassian.com/v1/mcp',
                    headers: { Authorization: 'Basic ${basic:input.ATLASSIAN_EMAIL:input.ATLASSIAN_API_TOKEN}' },
                },
            ],
        },
    ],
})

const BASIC_VAR = 'RERUN_SVC_ATLASSIAN_ATLASSIAN_EMAIL_ATLASSIAN_API_TOKEN_BASIC'

describe('compileService with a basic: placeholder', () => {
    beforeEach(() => vi.clearAllMocks())

    it('encodes both inputs into one secret and references it from the header', async () => {
        await compileService('agent', manifest, { ATLASSIAN_EMAIL: 'me@acme.com', ATLASSIAN_API_TOKEN: 'tok' }, 'api-token')

        expect(updateAgentKeys).toHaveBeenCalledWith({}, 'engine-agent', { set: { [BASIC_VAR]: Buffer.from('me@acme.com:tok').toString('base64') } })
        const [server] = vi.mocked(patchMcpServers).mock.calls[0][2].upsert!
        expect(server.headers).toEqual({ Authorization: `Basic \${${BASIC_VAR}}` })
    })

    it('keeps the raw token out of the compiled config and records the derived key for uninstall', async () => {
        await compileService('agent', manifest, { ATLASSIAN_EMAIL: 'me@acme.com', ATLASSIAN_API_TOKEN: 'tok' }, 'api-token')

        expect(JSON.stringify(vi.mocked(patchMcpServers).mock.calls[0])).not.toContain('tok')
        const [, , , entry] = vi.mocked(upsertRegistryEntry).mock.calls[0]
        expect(entry.envKeys).toEqual([BASIC_VAR])
        expect(entry.config).toEqual({ ATLASSIAN_EMAIL: 'me@acme.com' })
    })

    it('derives nothing when one side is missing', async () => {
        await compileService('agent', manifest, { ATLASSIAN_EMAIL: 'me@acme.com' }, 'api-token')

        expect(updateAgentKeys).not.toHaveBeenCalled()
    })
})

const INSTANCE = { key: 'atlassian@k3x9ab', instanceId: 'k3x9ab' }
const INSTANCE_BASIC_VAR = 'RERUN_SVC_ATLASSIAN_K3X9AB_ATLASSIAN_EMAIL_ATLASSIAN_API_TOKEN_BASIC'

describe('compileService for an extra account', () => {
    beforeEach(() => vi.clearAllMocks())

    it('suffixes the server name and keeps the env reference aligned with the key it sets', async () => {
        await compileService('agent', manifest, { ATLASSIAN_EMAIL: 'me@acme.com', ATLASSIAN_API_TOKEN: 'tok' }, 'api-token', undefined, INSTANCE)

        const [server] = vi.mocked(patchMcpServers).mock.calls[0][2].upsert!
        expect(server.name).toBe('atlassian-k3x9ab')
        expect(server.headers).toEqual({ Authorization: `Basic \${${INSTANCE_BASIC_VAR}}` })
        expect(Object.keys(vi.mocked(updateAgentKeys).mock.calls[0][2].set!)).toEqual([INSTANCE_BASIC_VAR])
    })

    it('writes the entry under its own key with an ordinal label', async () => {
        await compileService('agent', manifest, { ATLASSIAN_EMAIL: 'me@acme.com', ATLASSIAN_API_TOKEN: 'tok' }, 'api-token', undefined, INSTANCE)

        const [, , key, entry] = vi.mocked(upsertRegistryEntry).mock.calls[0]
        expect(key).toBe('atlassian@k3x9ab')
        expect(entry).toMatchObject({ instanceId: 'k3x9ab', label: 'Atlassian 2', mcpServers: ['atlassian-k3x9ab'] })
    })

    it('keeps the label of an account it recompiles', async () => {
        vi.mocked(readRegistry).mockResolvedValueOnce({ services: { 'atlassian@k3x9ab': { label: 'me@acme.com' } as never } })
        await compileService('agent', manifest, { ATLASSIAN_EMAIL: 'me@acme.com', ATLASSIAN_API_TOKEN: 'tok' }, 'api-token', undefined, INSTANCE)

        expect(vi.mocked(upsertRegistryEntry).mock.calls[0][3].label).toBe('me@acme.com')
    })

    it('leaves the base account untouched by any instance field', async () => {
        await compileService('agent', manifest, { ATLASSIAN_EMAIL: 'me@acme.com', ATLASSIAN_API_TOKEN: 'tok' }, 'api-token')

        const [, , key, entry] = vi.mocked(upsertRegistryEntry).mock.calls[0]
        expect(key).toBe('atlassian')
        expect(entry).not.toHaveProperty('instanceId')
        expect(entry).not.toHaveProperty('label')
        expect(readRegistry).not.toHaveBeenCalled()
    })

    it('suffixes an explicit env key of the manifest', async () => {
        const slack = serviceManifestSchema.parse({
            slug: 'slack',
            name: 'Slack',
            inputs: [{ key: 'bot_token', label: 'Bot token', type: 'password', required: true, secret: true }],
            envKeys: [{ key: 'SLACK_BOT_TOKEN', fromInput: 'bot_token' }],
            mcpServers: [{ name: 'slack', transport: 'stdio', command: 'npx', env: { SLACK_BOT_TOKEN: '${input.bot_token}' } }],
        })
        await compileService('agent', slack, { bot_token: 'xoxb' }, undefined, undefined, { key: 'slack@k3x9ab', instanceId: 'k3x9ab' })

        expect(vi.mocked(updateAgentKeys).mock.calls[0][2].set).toEqual({ SLACK_BOT_TOKEN_K3X9AB: 'xoxb' })
        const [server] = vi.mocked(patchMcpServers).mock.calls[0][2].upsert!
        expect(server.env).toEqual({ SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN_K3X9AB}' })
    })

    it('tells the Composio proxy which account it calls for', async () => {
        const gmail = serviceManifestSchema.parse({
            slug: 'gmail',
            name: 'Gmail',
            authMethods: [
                {
                    id: 'composio',
                    label: 'Connect',
                    kind: 'composio',
                    recommended: true,
                    composio: { toolkit: 'gmail', authConfigId: 'ac', allowedTools: [] },
                    mcpServers: [{ name: 'gmail', transport: 'http', url: '${RERUN_HUB_BASE_URL}/api/mcp/composio/gmail', headers: { 'x-rerun-agent': '${agent.id}' } }],
                },
            ],
        })
        const result = await compileService('agent', gmail, {}, undefined, undefined, { key: 'gmail@k3x9ab', instanceId: 'k3x9ab' })

        const [server] = vi.mocked(patchMcpServers).mock.calls[0][2].upsert!
        expect(server.headers).toEqual({ 'x-rerun-agent': 'engine-agent', 'x-rerun-instance': 'k3x9ab' })
        expect(result.composio).toEqual({ toolkit: 'gmail', serverName: 'gmail-k3x9ab' })
    })
})

describe('decompileService', () => {
    beforeEach(() => vi.clearAllMocks())

    it('leaves the skills another account still lists', async () => {
        const entry = { status: 'active' as const, config: {}, mcpServers: ['gmail-k3x9ab'], envKeys: [], skills: ['gmail-usage', 'own'], installedAt: '' }
        await decompileService({} as never, 'engine-agent', entry, { keepSkills: new Set(['gmail-usage']) })

        expect(vi.mocked(deleteSkill).mock.calls.map(call => call[2])).toEqual(['own'])
    })
})
