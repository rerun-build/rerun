import { FOREMAN_AGENT_ID, FOREMAN_HUB_TOKEN_HEADER } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readRerunCredit } from '@/app/api/_services/ai-status-hub.service'
import { dispatchAccountTool } from '@/app/api/_services/mcp-account.service'
import { dispatchHubTool } from '@/app/api/_services/services.service'
import { dispatchTeamHubTool } from '@/app/api/_services/team-hub.service'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { mintForemanHubToken } from '@/lib/foreman/hub-token'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import { POST } from './route'

vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn() }))
vi.mock('@/app/api/_services/services.service', () => ({ dispatchHubTool: vi.fn() }))
vi.mock('@/app/api/_services/team-hub.service', async () => ({ dispatchTeamHubTool: vi.fn(), isTeamHubTool: (name: string) => name.startsWith('team_') }))
vi.mock('@/app/api/_services/ai-status-hub.service', () => ({ readRerunCredit: vi.fn(), isAiStatusHubTool: (name: string) => name === 'rerun_credit' }))
vi.mock('@/app/api/_services/mcp-account.service', () => ({ dispatchAccountTool: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({ workspaceFounderUserId: vi.fn().mockResolvedValue('founder') }))
vi.mock('@/lib/foreman/onboarding-tools', () => ({ dispatchWorkspaceOnboardingTool: vi.fn() }))
vi.mock('@/lib/foreman/search-docs', () => ({ searchDocs: vi.fn() }))
vi.mock('@/lib/foreman/box-tools', () => ({ dispatchBoxTool: vi.fn() }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn().mockReturnValue({}) }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMaybeSingle: vi.fn() }))

const WORKSPACE_ID = 7

function hubRequest({ token = 'engine-key', agent, foremanToken, body = { tool: 'list_agents', args: {} } }: { token?: string | null; agent?: string; foremanToken?: string | null; body?: unknown } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token !== null) headers.authorization = `Bearer ${token}`
    if (agent !== undefined) headers['x-rerun-agent'] = agent
    if (foremanToken) headers[FOREMAN_HUB_TOKEN_HEADER] = foremanToken
    return new Request('https://rerun.test/api/hub', { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('POST /api/hub', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', 'test-secret')
        vi.stubEnv('FOREMAN_HUB_TOKEN_REQUIRED', '0')
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === 'engine-key' ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
        vi.mocked(dispatchAccountTool).mockResolvedValue({ agents: [] })
        vi.mocked(dispatchHubTool).mockResolvedValue({ ok: true } as never)
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('refuses a request without an engine key', async () => {
        const response = await POST(hubRequest({ token: null, agent: 'engine-agent' }))

        expect(response.status).toBe(401)
        expect(authenticateEngineToken).toHaveBeenCalledWith('')
        expect(dispatchHubTool).not.toHaveBeenCalled()
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('refuses a request carrying a key that names no engine', async () => {
        const response = await POST(hubRequest({ token: 'stolen-key', agent: FOREMAN_AGENT_ID }))

        expect(response.status).toBe(401)
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('asks for the calling agent before running anything', async () => {
        const response = await POST(hubRequest())

        expect(response.status).toBe(400)
        expect(selectMaybeSingle).not.toHaveBeenCalled()
        expect(dispatchHubTool).not.toHaveBeenCalled()
    })

    it('refuses an agent that belongs to another workspace', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: null, error: null })

        const response = await POST(hubRequest({ agent: 'engine-agent-of-someone-else' }))

        expect(response.status).toBe(403)
        expect(vi.mocked(selectMaybeSingle).mock.calls[0][1]).toBe('agents')
        expect(vi.mocked(selectMaybeSingle).mock.calls[0][3]).toEqual({ engine_agent_id: 'engine-agent-of-someone-else', workspace_id: WORKSPACE_ID })
        expect(dispatchHubTool).not.toHaveBeenCalled()
    })

    it('runs a hub tool as the agent the engine key workspace owns', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: { id: 'agent-1' }, error: null })

        const response = await POST(hubRequest({ agent: 'engine-agent', body: { tool: 'search_services', args: { query: 'gmail' } } }))

        expect(response.status).toBe(200)
        expect(dispatchHubTool).toHaveBeenCalledWith('agent-1', 'search_services', { query: 'gmail' }, WORKSPACE_ID)
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('routes a coworker reading its team to the read-only team dispatch', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: { id: 'agent-1' }, error: null })
        vi.mocked(dispatchTeamHubTool).mockResolvedValue({ agents: [] })

        const response = await POST(hubRequest({ agent: 'engine-agent', body: { tool: 'team_status', args: {} } }))

        expect(response.status).toBe(200)
        expect(dispatchTeamHubTool).toHaveBeenCalledWith('agent-1', WORKSPACE_ID, 'team_status', {})
        expect(dispatchHubTool).not.toHaveBeenCalled()
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('answers a coworker asking for the Rerun credit of the workspace its engine key names', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: { id: 'agent-1' }, error: null })
        vi.mocked(readRerunCredit).mockResolvedValue({ credit: null })

        const response = await POST(hubRequest({ agent: 'engine-agent', body: { tool: 'rerun_credit', args: {} } }))

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ credit: null })
        expect(readRerunCredit).toHaveBeenCalledWith(WORKSPACE_ID)
        expect(dispatchHubTool).not.toHaveBeenCalled()
    })

    it('routes the foreman to its own belt, scoped to the workspace of the engine key', async () => {
        const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, foremanToken: mintForemanHubToken(WORKSPACE_ID), body: { tool: 'list_agents', args: { spaceId: 'box-1' } } }))

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ agents: [] })
        expect(selectMaybeSingle).not.toHaveBeenCalled()
        expect(dispatchHubTool).not.toHaveBeenCalled()
        expect(dispatchAccountTool).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: WORKSPACE_ID }, 'list_agents', { spaceId: 'box-1' }, { actorUserId: null })
    })

    it('refuses a foreman tool that is not on its belt', async () => {
        const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, foremanToken: mintForemanHubToken(WORKSPACE_ID), body: { tool: 'create_template', args: {} } }))

        expect(await response.json()).toEqual({ error: 'Unknown foreman tool: create_template' })
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('refuses a caller holding the engine key that impersonates the Foreman via x-rerun-agent to reach account tools', async () => {
        vi.stubEnv('FOREMAN_HUB_TOKEN_REQUIRED', '')

        const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, body: { tool: 'list_agents', args: {} } }))

        expect(response.status).toBe(403)
        expect(await response.text()).toBe('Missing foreman token')
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('refuses a rewritten foreman token or one of another workspace, even while tolerant', async () => {
        const [payload, signature] = mintForemanHubToken(WORKSPACE_ID)!.split('.')
        const forged = `${Buffer.from(JSON.stringify({ ws: WORKSPACE_ID, exp: Date.now() + 1e12 })).toString('base64url')}.${signature}`

        for (const foremanToken of [mintForemanHubToken(99), forged, `${payload}.not-the-signature`]) {
            const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, foremanToken }))
            expect(response.status).toBe(403)
            expect(await response.text()).toBe('Invalid foreman token')
        }
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })

    it('lets a foreman call without a token through while tolerant, and logs it', async () => {
        const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, body: { tool: 'list_agents', args: {} } }))

        expect(response.status).toBe(200)
        expect(dispatchAccountTool).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: WORKSPACE_ID }, 'list_agents', {}, { actorUserId: null })
        expect(console.warn).toHaveBeenCalledWith('[hub] foreman call without token (tolerated)', { workspaceId: WORKSPACE_ID })
    })

    it('runs the foreman holding a valid token once the token is required', async () => {
        vi.stubEnv('FOREMAN_HUB_TOKEN_REQUIRED', '')

        const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, foremanToken: mintForemanHubToken(WORKSPACE_ID), body: { tool: 'list_agents', args: {} } }))

        expect(response.status).toBe(200)
        expect(dispatchAccountTool).toHaveBeenCalledWith({ kind: 'workspace', workspaceId: WORKSPACE_ID }, 'list_agents', {}, { actorUserId: null })
    })

    it('runs a member’s foreman turn with that member’s access, not the workspace’s', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: { role: 'member', box_scope: 'assigned' }, error: null })

        const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, foremanToken: mintForemanHubToken(WORKSPACE_ID, 'user-7'), body: { tool: 'list_agents', args: {} } }))

        expect(response.status).toBe(200)
        expect(vi.mocked(selectMaybeSingle).mock.calls[0][1]).toBe('workspace_members')
        expect(vi.mocked(selectMaybeSingle).mock.calls[0][3]).toEqual({ user_id: 'user-7', workspace_id: WORKSPACE_ID })
        expect(dispatchAccountTool).toHaveBeenCalledWith({ kind: 'user', userId: 'user-7', workspaceId: WORKSPACE_ID, role: 'member', boxScope: 'assigned' }, 'list_agents', {}, { actorUserId: 'user-7' })
    })

    it('refuses the foreman of a member who has left the workspace since the turn started', async () => {
        vi.mocked(selectMaybeSingle).mockResolvedValue({ data: null, error: null })

        const response = await POST(hubRequest({ agent: FOREMAN_AGENT_ID, foremanToken: mintForemanHubToken(WORKSPACE_ID, 'user-gone'), body: { tool: 'list_agents', args: {} } }))

        expect(response.status).toBe(403)
        expect(dispatchAccountTool).not.toHaveBeenCalled()
    })
})
