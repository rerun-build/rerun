import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { reportWorkspaceEvent } from '@/lib/apps/analytics'
import { runAction } from '@/lib/apps/linkup/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type SupabaseCall } from '@/test/supabase-fake'
import { POST } from './route'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/apps/analytics', () => ({ reportWorkspaceEvent: vi.fn() }))
vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), runAction: vi.fn() }))

const BOX_KEY = 'box-key-of-workspace-7'
const WORKSPACE_ID = 7

function eqValue(calls: readonly SupabaseCall[], column: string): unknown {
    return calls.find(call => call.method === 'eq' && call.args[0] === column)?.args[1]
}

// A coworker of the workspace that holds no binding to any LinkedIn account.
function workspaceWith(connectedAccounts: number) {
    return fakeSupabase((table, calls) => {
        if (table === 'agents') return { data: eqValue(calls, 'engine_agent_id') === 'engine-writer' ? { id: 'agent-writer' } : null }
        if (table === 'app_connections') return { count: eqValue(calls, 'workspace_id') === WORKSPACE_ID && eqValue(calls, 'status') === 'connected' ? connectedAccounts : 0 }
        return undefined
    })
}

function getProfile() {
    return new Request('https://rerun.test/api/mcp/apps/linkedin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rerun-key': BOX_KEY, 'x-rerun-agent': 'engine-writer' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_profile', arguments: { profile_url: 'https://www.linkedin.com/in/jane-doe' } } }),
    })
}

async function refusal(response: Response): Promise<string> {
    const body = await response.json()
    expect(body.result.isError).toBe(true)
    return JSON.parse(body.result.content[0].text).error
}

describe('POST /api/mcp/apps/[slug] for a coworker with no account attached', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === BOX_KEY ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
    })

    it('says the workspace already has an account and how to get it attached', async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(workspaceWith(1).client)

        const text = await refusal(await POST(getProfile(), { params: Promise.resolve({ slug: 'linkedin' }) }))

        expect(text).toContain('the workspace already has one: call suggest_service with linkedin-pro')
        expect(text).toContain('read them with paid_data')
        expect(runAction).not.toHaveBeenCalled()
    })

    it('asks for a connection when the workspace has no account yet', async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(workspaceWith(0).client)

        const text = await refusal(await POST(getProfile(), { params: Promise.resolve({ slug: 'linkedin' }) }))

        expect(text).toContain('call suggest_service with linkedin-pro so the user connects one')
        expect(text).not.toContain('already has one')
    })
})

// A coworker bound to a connected LinkedIn account of its own workspace, whose counters read `counts`
// after the call.
function workspaceWithBoundAccount(counts = [1]) {
    return fakeSupabase(table => {
        if (table === 'agents') return { data: { id: 'agent-writer' } }
        if (table === 'app_connection_agents') return { data: { connection_id: 'connection-1' } }
        if (table === 'app_connections') return { data: { id: 'connection-1', workspace_id: WORKSPACE_ID, app_slug: 'linkedin', status: 'connected', provider_account_id: 'linkup-account-1', label: 'Jane' } }
        if (table === 'workspace_apps') return { data: { status: 'active' } }
        if (table === 'rpc:count_app_usage') return { data: counts }
        return undefined
    })
}

function rpc(method: string, params?: Record<string, unknown>) {
    return new Request('https://rerun.test/api/mcp/apps/linkedin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-rerun-key': BOX_KEY, 'x-rerun-agent': 'engine-writer' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
}

async function answer(request: Request) {
    const body = await (await POST(request, { params: Promise.resolve({ slug: 'linkedin' }) })).json()
    return body.result
}

describe('POST /api/mcp/apps/[slug] and the tools it does not load', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === BOX_KEY ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
    })

    it('lists the everyday tools and the directory, not a tool of a scope', async () => {
        const names = (await answer(rpc('tools/list'))).tools.map((tool: { name: string }) => tool.name)

        expect(names).toEqual(expect.arrayContaining(['get_profile', 'send_message', 'list_tools', 'run_tool']))
        expect(names).not.toContain('sales_nav_search_people')
        expect(names).not.toContain('recruiter_get_cv')
        expect(names.length).toBeLessThanOrEqual(20)
    })

    it('reads a scope of the directory without looking any account up', async () => {
        const result = await answer(rpc('tools/call', { name: 'list_tools', arguments: { scope: 'recruiter' } }))

        const scope = JSON.parse(result.content[0].text)
        expect(scope.tools.map((tool: { name: string }) => tool.name)).toContain('recruiter_list_projects')
        expect(scope.requires).toBe('a LinkedIn Recruiter seat')
        expect(result.isError).toBeUndefined()
        expect(createServiceRoleClient).not.toHaveBeenCalled()
    })

    it('refuses a tool the directory does not hold before touching the account', async () => {
        const result = await answer(rpc('tools/call', { name: 'run_tool', arguments: { tool: 'delete_account' } }))

        expect(result.isError).toBe(true)
        expect(JSON.parse(result.content[0].text).error).toContain('Unknown tool "delete_account"')
        expect(createServiceRoleClient).not.toHaveBeenCalled()
        expect(runAction).not.toHaveBeenCalled()
    })

    it('runs a tool of a scope on the coworker’s account, metered like a loaded one', async () => {
        const supabase = workspaceWithBoundAccount()
        vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client)
        vi.mocked(runAction).mockResolvedValue({ visited: true })

        const result = await answer(rpc('tools/call', { name: 'run_tool', arguments: { tool: 'linkedin_pro_visit_profile', arguments: { profile_url: 'https://www.linkedin.com/in/jane-doe' } } }))

        expect(JSON.parse(result.content[0].text)).toEqual({ visited: true })
        expect(runAction).toHaveBeenCalledWith('linkup-account-1', 'profiles', 'visit', { profile_url: 'https://www.linkedin.com/in/jane-doe' })
        expect(supabase.chainsOn('rpc:count_app_usage')[0][0].args[1]).toMatchObject({ p_scope: 'connection:connection-1', p_action: 'profile_view', p_amount: 1 })
        expect(result.content).toHaveLength(1)
    })

    it('tells a coworker with no account so, whichever way the tool is called', async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(workspaceWith(0).client)

        const result = await answer(rpc('tools/call', { name: 'run_tool', arguments: { tool: 'visit_profile', arguments: { profile_url: 'https://www.linkedin.com/in/jane-doe' } } }))

        expect(JSON.parse(result.content[0].text).error).toContain('call suggest_service with linkedin-pro so the user connects one')
        expect(runAction).not.toHaveBeenCalled()
    })
})

describe('POST /api/mcp/apps/[slug] past the recommended pace of the account', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === BOX_KEY ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
        vi.mocked(runAction).mockResolvedValue({ name: 'Jane Doe' })
    })

    const getProfileCall = () => rpc('tools/call', { name: 'get_profile', arguments: { profile_url: 'https://www.linkedin.com/in/jane-doe' } })

    it('still reads the profile, and adds a notice the coworker tells the user', async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(workspaceWithBoundAccount([101]).client)

        const result = await answer(getProfileCall())

        expect(result.isError).toBeUndefined()
        expect(runAction).toHaveBeenCalled()
        expect(JSON.parse(result.content[0].text)).toEqual({ name: 'Jane Doe' })
        expect(result.content[1].text).toContain('past its recommended profile view pace (101 today, 100 per day recommended)')
        expect(result.content[1].text).toContain("Going on is the user's call")
    })

    it('reports the pace once, on the call that goes past it', async () => {
        vi.mocked(createServiceRoleClient).mockReturnValue(workspaceWithBoundAccount([101]).client)
        await answer(getProfileCall())
        expect(reportWorkspaceEvent).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, 'app_quota_hit', { app: 'linkedin', action: 'profile_view' })

        vi.mocked(reportWorkspaceEvent).mockClear()
        vi.mocked(createServiceRoleClient).mockReturnValue(workspaceWithBoundAccount([102]).client)
        await answer(getProfileCall())
        expect(reportWorkspaceEvent).not.toHaveBeenCalled()
    })
})
