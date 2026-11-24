import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimSignIn, holdsParkedSignIn, purgeExpiredGrants } from './pending-grant'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const COMPOSIO = { kind: 'composio', key: 'item-1', connectedAccountId: 'ca_1' }
const MANAGED = { kind: 'managed', key: 'item-1', provider: 'typeform', serverName: 'typeform', token: { accessToken: 'at' } }
const ABANDONED = { workspaceId: 7, itemId: 'item-1', connectedAccountId: 'ca_1' }
const row = (over: object = {}) => ({ jti: 'row-1', agent_id: '', workspace_id: 7, user_id: 'user-1', payload: COMPOSIO, expires_at: new Date(Date.now() + 60_000).toISOString(), ...over })
const CLAIMANT = { agentId: '', workspaceId: 7, userId: 'user-1' }

function withRows(data: unknown) {
    const db = fakeSupabase(() => ({ data }))
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    return db
}

beforeEach(() => vi.clearAllMocks())

describe('purgeExpiredGrants', () => {
    it('deletes the expired rows, and hands back the Composio accounts of Vault entries alone', async () => {
        const db = withRows([row(), row({ agent_id: 'agent-1', payload: { ...COMPOSIO, key: 'gmail' } }), row({ payload: MANAGED }), row({ payload: null })])
        expect(await purgeExpiredGrants()).toEqual([ABANDONED])
        expect(db.writes('oauth_pending_grants')).toEqual([expect.objectContaining({ method: 'delete', filters: expect.arrayContaining([expect.objectContaining({ method: 'lt', args: ['expires_at', expect.any(String)] })]) })])
    })
})

describe('holdsParkedSignIn', () => {
    it('is true of a row the callback filled, and of no other', async () => {
        withRows(row())
        expect(await holdsParkedSignIn('row-1')).toBe(true)
        withRows(row({ payload: null }))
        expect(await holdsParkedSignIn('row-1')).toBe(false)
        withRows(null)
        expect(await holdsParkedSignIn('row-1')).toBe(false)
    })
})

describe('claimSignIn', () => {
    it('hands the parked sign-in to who started it', async () => {
        withRows(row())
        expect(await claimSignIn('row-1', CLAIMANT)).toEqual(COMPOSIO)
    })

    it('names the Vault account a refused or expired claim leaves', async () => {
        withRows(row())
        await expect(claimSignIn('row-1', { ...CLAIMANT, userId: 'user-2' })).rejects.toMatchObject({ abandoned: ABANDONED })
        withRows(row({ expires_at: new Date(Date.now() - 1).toISOString() }))
        await expect(claimSignIn('row-1', CLAIMANT)).rejects.toMatchObject({ abandoned: ABANDONED })
    })

    it('names none for a coworker, a sign-in still empty or a row already spent', async () => {
        withRows(row({ agent_id: 'agent-1' }))
        await expect(claimSignIn('row-1', CLAIMANT)).rejects.toMatchObject({ abandoned: null })
        withRows(row({ payload: null }))
        await expect(claimSignIn('row-1', CLAIMANT)).rejects.toMatchObject({ abandoned: null })
        withRows(null)
        await expect(claimSignIn('row-1', CLAIMANT)).rejects.toMatchObject({ abandoned: null })
    })
})
