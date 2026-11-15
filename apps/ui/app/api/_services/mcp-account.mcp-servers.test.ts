import { workspaceActor } from '@/app/api/_auth/access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteMcpToken, getAgent, patchMcpServers } from '@/lib/engine/client'
import { ACCOUNT_TOOL_DEFS } from '@/lib/mcp/account-tools'
import { readRegistry } from '@/lib/services/registry'

import { resolveAgentTarget } from './chat.service'
import { dispatchAccountTool } from './mcp-account.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client')
vi.mock('@/lib/services/registry', () => ({
    readRegistry: vi.fn(),
    connectorSkillOwners: () => new Map(),
    connectorMcpServerNames: (reg: { claimed?: string[] }) => new Set(reg.claimed ?? []),
}))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), getConnectionForAgent: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('./agent.service', () => ({ changeAgentHandle: vi.fn(), createAgent: vi.fn(), deleteAgent: vi.fn(), duplicateAgent: vi.fn(), moveAgentToBox: vi.fn(), renameAgent: vi.fn() }))
vi.mock('./agent-setup.service', () => ({ declareService: vi.fn(), installServiceSlugs: vi.fn() }))
vi.mock('./chat.service', () => ({ ensureSessionRow: vi.fn(), resolveAgentTarget: vi.fn() }))
vi.mock('./services.service', () => ({ allocateServiceInstance: vi.fn(), installedFromRegistry: vi.fn(), listCatalogServices: vi.fn(), listInstalledServices: vi.fn(), loadManifest: vi.fn(), searchCatalogServices: vi.fn(), toAuthMethodSummaries: vi.fn(() => []), uninstallService: vi.fn() }))
vi.mock('./mcp-shares.service', () => ({ dispatchShareTool: vi.fn() }))

const CONN = { baseUrl: 'https://engine.test', apiKey: null }
const ACTOR = workspaceActor(7)
const SECRET = 'sk-top-secret-value'

function configOf(...names: string[]) {
    return { config: { mcpServers: names.map(name => ({ name, args: [], env: {}, headers: {} })) } } as never
}

describe('attach_mcp_server and detach_mcp_server account tools', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: CONN, engineAgentId: 'engine-own', contentLocked: false } as never)
        vi.mocked(readRegistry).mockResolvedValue({ services: {}, claimed: [] } as never)
        vi.mocked(patchMcpServers).mockResolvedValue({} as never)
        vi.mocked(deleteMcpToken).mockResolvedValue(undefined)
    })

    it('detach removes exactly the named server and leaves the others', async () => {
        vi.mocked(getAgent).mockResolvedValue(configOf('a', 'b', 'c'))
        const out = await dispatchAccountTool(ACTOR, 'detach_mcp_server', { agentId: 'agent-own', name: 'b' })
        expect(patchMcpServers).toHaveBeenCalledTimes(1)
        expect(patchMcpServers).toHaveBeenCalledWith(CONN, 'engine-own', { remove: ['b'] })
        expect(out).toEqual({ removed: 'b', remaining: ['a', 'c'] })
    })

    it('detach refuses a server claimed by an installed app', async () => {
        vi.mocked(getAgent).mockResolvedValue(configOf('a', 'b'))
        vi.mocked(readRegistry).mockResolvedValue({ services: {}, claimed: ['b'] } as never)
        await expect(dispatchAccountTool(ACTOR, 'detach_mcp_server', { agentId: 'agent-own', name: 'b' })).rejects.toThrow('"b" belongs to an app. Manage it from the Apps tab.')
        expect(patchMcpServers).not.toHaveBeenCalled()
    })

    it('detach of an unknown name is an error and patches nothing', async () => {
        vi.mocked(getAgent).mockResolvedValue(configOf('a'))
        await expect(dispatchAccountTool(ACTOR, 'detach_mcp_server', { agentId: 'agent-own', name: 'zzz' })).rejects.toThrow('Coworker has no tool server named "zzz".')
        expect(patchMcpServers).not.toHaveBeenCalled()
    })

    it('attach upserts exactly one server and answers without any env or header value', async () => {
        const out = await dispatchAccountTool(ACTOR, 'attach_mcp_server', {
            agentId: 'agent-own',
            name: 'docs',
            transport: 'http',
            url: `https://mcp.example.com/path?token=${SECRET}`,
            env: { B_KEY: SECRET, A_KEY: SECRET },
            headers: { Authorization: SECRET },
        })
        expect(patchMcpServers).toHaveBeenCalledTimes(1)
        const body = vi.mocked(patchMcpServers).mock.calls[0][2]
        expect(body.remove).toBeUndefined()
        expect(body.upsert).toHaveLength(1)
        expect(body.upsert?.[0]).toMatchObject({ name: 'docs', transport: 'http', env: { B_KEY: SECRET, A_KEY: SECRET }, headers: { Authorization: SECRET } })
        expect(JSON.stringify(out)).not.toContain(SECRET)
        expect(out).toMatchObject({ name: 'docs', transport: 'http', urlOrigin: 'https://mcp.example.com', envKeys: ['A_KEY', 'B_KEY'], headerKeys: ['Authorization'] })
    })

    it('attach answers a stdio server with its command and argument count', async () => {
        const out = await dispatchAccountTool(ACTOR, 'attach_mcp_server', { agentId: 'agent-own', name: 'local', command: 'npx', args: ['-y', 'pkg'] })
        expect(out).toMatchObject({ name: 'local', transport: 'stdio', command: 'npx', argCount: 2, envKeys: [], headerKeys: [] })
    })

    it('attach refuses rerun, a 65 character name, a name with a space, stdio without a command, http without a url, and an app-claimed name', async () => {
        vi.mocked(readRegistry).mockResolvedValue({ services: {}, claimed: ['claimed'] } as never)
        const attempts: Record<string, unknown>[] = [
            { name: 'rerun', command: 'x' },
            { name: 'n'.repeat(65), command: 'x' },
            { name: 'has space', command: 'x' },
            { name: 'nocmd', transport: 'stdio' },
            { name: 'nocmd2' },
            { name: 'nourl', transport: 'http' },
            { name: 'nourl2', transport: 'sse' },
            { name: 'claimed', command: 'x' },
        ]
        for (const attempt of attempts) {
            await expect(dispatchAccountTool(ACTOR, 'attach_mcp_server', { agentId: 'agent-own', ...attempt })).rejects.toThrow()
        }
        expect(patchMcpServers).not.toHaveBeenCalled()
    })

    it('both tools ask for manage permission', async () => {
        vi.mocked(getAgent).mockResolvedValue(configOf('a'))
        await dispatchAccountTool(ACTOR, 'attach_mcp_server', { agentId: 'agent-own', name: 'x', command: 'y' })
        await dispatchAccountTool(ACTOR, 'detach_mcp_server', { agentId: 'agent-own', name: 'a' })
        const calls = vi.mocked(resolveAgentTarget).mock.calls
        expect(calls.length).toBeGreaterThanOrEqual(2)
        for (const call of calls) expect(call[2]).toBe('manage')
    })

    it('both tools are advertised with agentId and name required', () => {
        for (const name of ['attach_mcp_server', 'detach_mcp_server']) {
            const tool = ACCOUNT_TOOL_DEFS.find(t => t.name === name) as { inputSchema: { required: string[] } } | undefined
            expect(tool?.inputSchema.required).toEqual(['agentId', 'name'])
        }
    })
})
