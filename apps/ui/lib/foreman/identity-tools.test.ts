import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { dispatchForemanIdentityTool } from './identity-tools'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))

const admin: Actor = { kind: 'user', userId: 'admin-1', workspaceId: 7, role: 'admin', boxScope: 'all' }
const member: Actor = { ...admin, userId: 'member-1', role: 'member' }
let written: Array<{ patch: Record<string, unknown>; id: unknown }>

beforeEach(() => {
    written = []
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: () => ({ update: (patch: Record<string, unknown>) => ({ eq: async (_column: string, id: unknown) => (written.push({ patch, id }), { error: null }) }) }) } as never)
})

describe('set_assistant_name', () => {
    it('gives the Chief of Staff the name an admin chose, on one line', async () => {
        expect(await dispatchForemanIdentityTool(admin, 'set_assistant_name', { name: '  Max \n ' })).toMatchObject({ name: 'Max' })
        expect(written).toEqual([{ patch: { assistant_name: 'Max' }, id: 7 }])
    })

    it('goes back to "Chief of Staff" on an empty name', async () => {
        expect(await dispatchForemanIdentityTool(admin, 'set_assistant_name', { name: ' ' })).toMatchObject({ name: null })
        expect(written[0].patch).toEqual({ assistant_name: null })
    })

    it('refuses a member, and a name too long to be one', async () => {
        await expect(dispatchForemanIdentityTool(member, 'set_assistant_name', { name: 'Max' })).rejects.toThrow('Only an admin')
        await expect(dispatchForemanIdentityTool(admin, 'set_assistant_name', { name: 'x'.repeat(41) })).rejects.toThrow('40 characters')
        await expect(dispatchForemanIdentityTool(admin, 'set_assistant_name', { name: 42 })).rejects.toThrow()
        expect(written).toEqual([])
    })
})
