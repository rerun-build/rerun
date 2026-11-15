import { workspaceActor } from '@/app/api/_auth/access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAgent, listConnections, listSchedules, listSkills, listTriggers, patchMcpServers } from '@/lib/engine/client'
import { ACCOUNT_TOOL_DEFS } from '@/lib/mcp/account-tools'
import { connectorMcpServerNames, readRegistry } from '@/lib/services/registry'

import { resolveAgentTarget } from './chat.service'
import { listInstalledServices } from './services.service'
import { dispatchAccountTool } from './mcp-account.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client')
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn(), connectorSkillOwners: () => new Map(), connectorMcpServerNames: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), getConnectionForAgent: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('./agent.service', () => ({ changeAgentHandle: vi.fn(), createAgent: vi.fn(), deleteAgent: vi.fn(), duplicateAgent: vi.fn(), moveAgentToBox: vi.fn(), renameAgent: vi.fn() }))
vi.mock('./agent-setup.service', () => ({ declareService: vi.fn(), installServiceSlugs: vi.fn() }))
vi.mock('./chat.service', () => ({ ensureSessionRow: vi.fn(), resolveAgentTarget: vi.fn() }))
vi.mock('./services.service', () => ({ allocateServiceInstance: vi.fn(), listCatalogServices: vi.fn(), listInstalledServices: vi.fn(), loadManifest: vi.fn(), searchCatalogServices: vi.fn(), toAuthMethodSummaries: vi.fn(() => []), uninstallService: vi.fn() }))
vi.mock('./mcp-shares.service', () => ({ dispatchShareTool: vi.fn() }))

const CONN = { baseUrl: 'https://engine.test', apiKey: null }
const ACTOR = workspaceActor(7)
const DOCS = { name: 'docs', transport: 'http', url: 'https://docs.test/mcp', args: [], env: { TOKEN: 'secret' }, headers: { Authorization: 'Bearer x' } }
const OTHER = { name: 'other', transport: 'stdio', command: 'run', args: ['a'], env: { K: 'v' }, headers: {} }

const agentWith = (mcpServers: unknown[]) => ({ config: { name: 'a', mcpServers, setup: {} }, soul: '' }) as never
const upserted = () => (vi.mocked(patchMcpServers).mock.calls[0][2] as { upsert: Record<string, unknown>[] }).upsert

describe('set_mcp_server_tools account tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: CONN, engineAgentId: 'engine-own', contentLocked: false } as never)
        vi.mocked(getAgent).mockResolvedValue(agentWith([DOCS, OTHER]))
        vi.mocked(readRegistry).mockResolvedValue({} as never)
        vi.mocked(connectorMcpServerNames).mockReturnValue(new Set(['claimed']))
        vi.mocked(patchMcpServers).mockResolvedValue(undefined as never)
    })

    it('sets the picks on the named server and leaves the other servers and their secrets as they were', async () => {
        const out = await dispatchAccountTool(ACTOR, 'set_mcp_server_tools', { agentId: 'agent-own', name: 'docs', tools: ['search', 'read'] })
        expect(upserted()).toEqual([{ ...DOCS, tools: ['search', 'read'] }])
        expect(out).toEqual({ name: 'docs', picks: ['search', 'read'] })
        expect(JSON.stringify(out)).not.toContain('secret')
    })

    it('an empty list removes the key', async () => {
        vi.mocked(getAgent).mockResolvedValue(agentWith([{ ...DOCS, tools: ['x'] }]))
        const out = await dispatchAccountTool(ACTOR, 'set_mcp_server_tools', { agentId: 'agent-own', name: 'docs', tools: [] })
        expect('tools' in upserted()[0]).toBe(false)
        expect(out).toEqual({ name: 'docs', picks: [] })
    })

    it('refuses an unknown server, an app-claimed server, 201 names and an empty name', async () => {
        vi.mocked(getAgent).mockResolvedValue(agentWith([DOCS, { ...OTHER, name: 'claimed' }]))
        const call = (args: Record<string, unknown>) => dispatchAccountTool(ACTOR, 'set_mcp_server_tools', { agentId: 'agent-own', name: 'docs', tools: ['a'], ...args })
        await expect(call({ name: 'nope' })).rejects.toThrow('Coworker has no tool server named "nope".')
        await expect(call({ name: 'claimed' })).rejects.toThrow('"claimed" belongs to an app. Manage it from the Apps tab.')
        await expect(call({ tools: Array.from({ length: 201 }, (_, i) => `t${i}`) })).rejects.toThrow()
        await expect(call({ tools: [''] })).rejects.toThrow()
        await expect(call({ tools: ['x'.repeat(129)] })).rejects.toThrow()
        expect(patchMcpServers).not.toHaveBeenCalled()
    })

    it('asks for manage permission', async () => {
        await dispatchAccountTool(ACTOR, 'set_mcp_server_tools', { agentId: 'agent-own', name: 'docs', tools: ['a'] })
        expect(vi.mocked(resolveAgentTarget).mock.calls[0][2]).toBe('manage')
    })

    it('get_agent shows the picks of a server and nothing for a server without', async () => {
        vi.mocked(listConnections).mockResolvedValue({ connections: [] } as never)
        vi.mocked(listSkills).mockResolvedValue([])
        vi.mocked(listSchedules).mockResolvedValue([])
        vi.mocked(listTriggers).mockResolvedValue([])
        vi.mocked(listInstalledServices).mockResolvedValue({ services: [] } as never)
        vi.mocked(getAgent).mockResolvedValue({ config: { name: 'a', mcpServers: [{ ...DOCS, tools: ['search'] }, OTHER], setup: {}, tools: {} }, soul: '' } as never)
        const out = (await dispatchAccountTool(ACTOR, 'get_agent', { agentId: 'agent-own' })) as { mcpServers: Record<string, unknown>[] }
        expect(out.mcpServers[0]).toMatchObject({ name: 'docs', tools: ['search'] })
        expect('tools' in out.mcpServers[1]).toBe(false)
    })

    it('is advertised with agentId, name and tools required', () => {
        const tool = ACCOUNT_TOOL_DEFS.find(t => t.name === 'set_mcp_server_tools') as { description: string; inputSchema: { required: string[]; properties: Record<string, { type: string }> } } | undefined
        expect(tool?.inputSchema.required).toEqual(['agentId', 'name', 'tools'])
        expect(tool?.inputSchema.properties.tools.type).toBe('array')
        expect(tool?.description.length).toBeGreaterThan(40)
    })
})
