import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { assertAgentAccess } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'
import { attachAgentToConnection } from './apps.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({ assertAgentAccess: vi.fn(), assertAgentInWorkspace: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({
    AuthorizationError: class AuthorizationError extends Error {},
    requireWorkspaceContext: vi.fn(),
}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/ee/lib/billing/stripe', () => ({ intervalOfItems: vi.fn(), stripe: {} }))

// An API key carries no browser session: the member it acts for arrives as the actor.
const KEY_ACTOR: Actor = { kind: 'user', userId: 'u-1', workspaceId: 7, role: 'member', boxScope: 'all' }

let supabase: FakeSupabase

function workspaceHoldsTheAccount(holds: boolean) {
    supabase = fakeSupabase((table, calls) => {
        if (table === 'app_connections') return { data: holds ? { status: 'connected' } : null }
        if (table === 'app_connection_agents' && !writeMethodOf(calls)) return { data: null }
        return undefined
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client)
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(assertAgentAccess).mockResolvedValue({ actor: KEY_ACTOR } as never)
    vi.mocked(requireWorkspaceContext).mockRejectedValue(new Error('no browser session'))
})

describe('attachAgentToConnection', () => {
    it('binds the coworker to an account of the actor workspace, without a browser session', async () => {
        workspaceHoldsTheAccount(true)

        await attachAgentToConnection('linkedin', 'agent-1', 'conn-a', KEY_ACTOR)

        expect(assertAgentAccess).toHaveBeenCalledWith('agent-1', 'manage', KEY_ACTOR)
        expect(requireWorkspaceContext).not.toHaveBeenCalled()
        expect(supabase.chainsOn('app_connections')[0]).toContainEqual({ table: 'app_connections', method: 'eq', args: ['workspace_id', 7] })
        expect(supabase.writes('app_connection_agents')).toEqual([expect.objectContaining({ method: 'insert', payload: { agent_id: 'agent-1', app_slug: 'linkedin', connection_id: 'conn-a' } })])
    })

    it('refuses an account the actor workspace does not hold', async () => {
        workspaceHoldsTheAccount(false)

        await expect(attachAgentToConnection('linkedin', 'agent-1', 'conn-elsewhere', KEY_ACTOR)).rejects.toThrow('accountNotFound')
        expect(supabase.writes('app_connection_agents')).toEqual([])
    })
})
