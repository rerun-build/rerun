import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { runAction } from '@/lib/apps/linkup/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, type SupabaseCall } from '@/test/supabase-fake'
import { POST } from './route'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn(), getWorkspaceConnection: vi.fn() }))
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
