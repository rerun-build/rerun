import { workspaceActor } from '@/app/api/_auth/access'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconnectMcpServer } from '@/lib/engine/client'
import { ACCOUNT_TOOL_DEFS } from '@/lib/mcp/account-tools'

import { resolveAgentTarget } from './chat.service'
import { dispatchAccountTool } from './mcp-account.service'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client')
vi.mock('@/lib/services/registry', () => ({ readRegistry: vi.fn(), connectorSkillOwners: () => new Map() }))
vi.mock('./workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), getConnectionForAgent: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('./agent.service', () => ({ changeAgentHandle: vi.fn(), createAgent: vi.fn(), deleteAgent: vi.fn(), duplicateAgent: vi.fn(), moveAgentToBox: vi.fn(), renameAgent: vi.fn() }))
vi.mock('./agent-setup.service', () => ({ declareService: vi.fn(), installServiceSlugs: vi.fn() }))
vi.mock('./chat.service', () => ({ ensureSessionRow: vi.fn(), resolveAgentTarget: vi.fn() }))
vi.mock('./services.service', () => ({ allocateServiceInstance: vi.fn(), listCatalogServices: vi.fn(), listInstalledServices: vi.fn(), loadManifest: vi.fn(), searchCatalogServices: vi.fn(), toAuthMethodSummaries: vi.fn(() => []), uninstallService: vi.fn() }))
vi.mock('./mcp-shares.service', () => ({ dispatchShareTool: vi.fn() }))

const CONN = { baseUrl: 'https://engine.test', apiKey: null }
const ACTOR = workspaceActor(7)

describe('reconnect_mcp_server account tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: CONN, engineAgentId: 'engine-own', contentLocked: false } as never)
        vi.mocked(reconnectMcpServer).mockResolvedValue({ name: 'docs', reconnected: true, effect: 'next_call', announced: 2 })
    })

    it('reconnects the named server of the coworker and answers the effect', async () => {
        const out = await dispatchAccountTool(ACTOR, 'reconnect_mcp_server', { agentId: 'agent-own', name: 'docs' })
        expect(reconnectMcpServer).toHaveBeenCalledWith(CONN, 'engine-own', 'docs')
        expect(out).toMatchObject({ name: 'docs', reconnected: true, effect: 'next_call', announced: 2 })
    })

    it('sends the engine the id resolveAgentTarget returned', async () => {
        await dispatchAccountTool(ACTOR, 'reconnect_mcp_server', { agentId: 'agent-own', name: 'docs' })
        expect(vi.mocked(reconnectMcpServer).mock.calls[0][1]).toBe('engine-own')
    })

    it('asks for use permission', async () => {
        await dispatchAccountTool(ACTOR, 'reconnect_mcp_server', { agentId: 'agent-own', name: 'docs' })
        expect(vi.mocked(resolveAgentTarget).mock.calls[0][2]).toBe('use')
    })

    it('refuses a missing name and calls the engine not at all', async () => {
        await expect(dispatchAccountTool(ACTOR, 'reconnect_mcp_server', { agentId: 'agent-own' })).rejects.toThrow()
        expect(reconnectMcpServer).not.toHaveBeenCalled()
    })

    it('is advertised with agentId and name required', () => {
        const tool = ACCOUNT_TOOL_DEFS.find(t => t.name === 'reconnect_mcp_server') as { description: string; inputSchema: { required: string[] } } | undefined
        expect(tool?.inputSchema.required).toEqual(['agentId', 'name'])
        expect(tool?.description.length).toBeGreaterThan(40)
    })

    it('answers nothing but name, reconnected, effect, announced and the agent id', async () => {
        const out = (await dispatchAccountTool(ACTOR, 'reconnect_mcp_server', { agentId: 'agent-own', name: 'docs' })) as Record<string, unknown>
        expect(Object.keys(out).sort()).toEqual(['agentId', 'announced', 'effect', 'name', 'reconnected'])
        expect(out.agentId).toBe('agent-own')
    })
})
