import { beforeEach, describe, expect, it, vi } from 'vitest'

import { attachVaultItem, createVaultItem, getVaultItem, patchVaultItem, updateVaultItemEnv } from '@/lib/engine/vault-client'
import { serviceManifestSchema } from '@/lib/services/manifest'
import { compileServiceParts } from '@/lib/services/compiler'
import { VAULT_AGENT_REF, compileIntoVault, vaultSkills } from './install'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn() }))
vi.mock('@/lib/composio/client', () => ({ deleteConnectedAccount: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ createSkill: vi.fn(), deleteMcpToken: vi.fn(), deleteSkill: vi.fn(), listSkills: vi.fn(), patchMcpServers: vi.fn(), updateAgentKeys: vi.fn(), updateSkill: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({
    createVaultItem: vi.fn(async (_conn: unknown, input: Record<string, unknown>) => ({ id: 'new-item', ...input })),
    patchVaultItem: vi.fn(async () => ({ id: 'item-1', agentIds: [], sharedWithAll: false })),
    getVaultItem: vi.fn(async () => ({ id: 'item-1', agentIds: ['engine-agent'], authMethodId: 'api-token', envKeys: ['RERUN_SVC_ATLASSIAN_ATLASSIAN_API_TOKEN'] })),
    attachVaultItem: vi.fn(async () => ({ id: 'item-1', agentIds: ['engine-agent'], sharedWithAll: false })),
    updateVaultItemEnv: vi.fn(),
}))

const conn = { baseUrl: 'https://engine.test', apiKey: null }

const manifest = serviceManifestSchema.parse({
    name: 'Atlassian',
    slug: 'atlassian',
    summary: 's',
    description: 'd',
    category: 'dev',
    skills: [
        { name: 'Jira triage', description: 'How', body: 'Use the tools for ${input.ATLASSIAN_EMAIL}.' },
        { name: 'Jira triage', description: 'Duplicate', body: 'Ignored.' },
    ],
    authMethods: [
        {
            id: 'api-token',
            kind: 'key',
            label: 'API token',
            inputs: [
                { key: 'ATLASSIAN_EMAIL', label: 'Email', type: 'text', required: true, secret: false },
                { key: 'ATLASSIAN_API_TOKEN', label: 'Token', type: 'password', required: true, secret: true },
            ],
            mcpServers: [{ name: 'atlassian', transport: 'http', url: 'https://mcp.atlassian.test/v1', headers: { Authorization: 'Bearer ${input.ATLASSIAN_API_TOKEN}', 'x-agent': '${agent.id}' } }],
        },
    ],
})
const values = { ATLASSIAN_EMAIL: 'ops@acme.test', ATLASSIAN_API_TOKEN: 'tok-secret' }

beforeEach(() => vi.clearAllMocks())

describe('compileServiceParts', () => {
    it("writes no coworker's id into a Vault item, and keeps every secret out of its servers", () => {
        const parts = compileServiceParts(manifest, values, 'api-token', VAULT_AGENT_REF)
        expect(parts.servers[0].headers).toEqual({ Authorization: 'Bearer ${RERUN_SVC_ATLASSIAN_ATLASSIAN_API_TOKEN}', 'x-agent': '${RERUN_AGENT_ID}' })
        expect(parts.env).toEqual({ RERUN_SVC_ATLASSIAN_ATLASSIAN_API_TOKEN: 'tok-secret' })
        expect(parts.config).toEqual({ ATLASSIAN_EMAIL: 'ops@acme.test' })
        expect(parts.status).toBe('active')
        expect(JSON.stringify(parts.servers)).not.toContain('tok-secret')
    })

    it('suffixes the servers and variables of an extra account', () => {
        const parts = compileServiceParts(manifest, values, 'api-token', VAULT_AGENT_REF, 'k3x9ab')
        expect(parts.servers[0].name).toBe('atlassian-k3x9ab')
        expect(Object.keys(parts.env)).toEqual(['RERUN_SVC_ATLASSIAN_K3X9AB_ATLASSIAN_API_TOKEN'])
    })
})

describe('compileIntoVault', () => {
    it('creates an item attached to the coworker installing it, with its secrets beside it', async () => {
        const { item, toolNames } = await compileIntoVault({ conn, manifest, values, authMethodId: 'api-token', engineAgentId: 'engine-agent', createdBy: 'user-1' })
        expect(toolNames).toEqual(['atlassian'])
        expect(item.id).toBe('new-item')
        const input = vi.mocked(createVaultItem).mock.calls[0][1]
        expect(input).toMatchObject({ kind: 'service', slug: 'atlassian', name: 'Atlassian', status: 'active', authMethodId: 'api-token', agentIds: ['engine-agent'], createdBy: 'user-1', env: { RERUN_SVC_ATLASSIAN_ATLASSIAN_API_TOKEN: 'tok-secret' } })
        expect(input.skills).toEqual([{ slug: 'jira-triage', name: 'Jira triage', description: 'How', body: 'Use the tools for ops@acme.test.' }])
        expect(input).not.toHaveProperty('oauth')
    })

    it('compiles an existing item again in place, attaching the coworker that was not on it', async () => {
        vi.mocked(patchVaultItem).mockResolvedValue({ id: 'item-1', agentIds: ['other'], sharedWithAll: false } as never)
        await compileIntoVault({ conn, manifest, values, authMethodId: 'api-token', itemId: 'item-1', engineAgentId: 'engine-agent' })
        expect(updateVaultItemEnv).toHaveBeenCalledWith(conn, 'item-1', { set: { RERUN_SVC_ATLASSIAN_ATLASSIAN_API_TOKEN: 'tok-secret' }, remove: [] })
        expect(patchVaultItem).toHaveBeenCalledWith(conn, 'item-1', expect.objectContaining({ status: 'active', oauth: null, managed: null, composio: null, app: null }))
        expect(attachVaultItem).toHaveBeenCalledWith(conn, 'item-1', 'engine-agent')
        expect(getVaultItem).toHaveBeenCalled()
        expect(createVaultItem).not.toHaveBeenCalled()
    })

    it('drops the variables of the method it was compiled with before', async () => {
        vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', agentIds: [], authMethodId: 'oauth', envKeys: ['OLD_TOKEN', 'RERUN_SVC_ATLASSIAN_ATLASSIAN_API_TOKEN'] } as never)
        await compileIntoVault({ conn, manifest, values, authMethodId: 'api-token', itemId: 'item-1' })
        expect(updateVaultItemEnv).toHaveBeenCalledWith(conn, 'item-1', { set: { RERUN_SVC_ATLASSIAN_ATLASSIAN_API_TOKEN: 'tok-secret' }, remove: ['OLD_TOKEN'] })
    })

    it('keeps the secret held when the form leaves it blank', async () => {
        await compileIntoVault({ conn, manifest, values: { ATLASSIAN_EMAIL: 'ops@acme.test' }, authMethodId: 'api-token', itemId: 'item-1' })
        expect(updateVaultItemEnv).not.toHaveBeenCalled()
    })
})

describe('vaultSkills', () => {
    it('slugs a skill the way the engine would, and drops an empty or repeated one', () => {
        expect(vaultSkills([{ name: 'Gmail: How-to', description: '', body: 'x' }, { name: 'Gmail how to', description: '', body: 'y' }, { name: 'Empty', description: '', body: '  ' }])).toEqual([
            { slug: 'gmail-how-to', name: 'Gmail: How-to', description: '', body: 'x' },
        ])
    })
})
