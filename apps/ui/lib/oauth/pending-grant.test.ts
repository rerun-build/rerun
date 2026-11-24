import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase } from '@/test/supabase-fake'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { holdsParkedSignIn } from './pending-grant'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const COMPOSIO = { kind: 'composio', key: 'item-1', connectedAccountId: 'ca_1' }
const row = (over: object = {}) => ({ jti: 'row-1', agent_id: '', workspace_id: 7, user_id: 'user-1', payload: COMPOSIO, expires_at: new Date(Date.now() + 60_000).toISOString(), ...over })

function withRows(data: unknown) {
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeSupabase(() => ({ data })).client)
}

beforeEach(() => vi.clearAllMocks())

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
