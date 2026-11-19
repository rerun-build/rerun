import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { Database } from '@/app/api/database.types'
vi.mock('@moldwright/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))

const mocks = vi.hoisted(() => ({ selectMany: vi.fn() }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/supabase/supabase-helpers', () => ({ selectMany: mocks.selectMany, selectMaybeSingle: vi.fn() }))

const { listUserWorkspaces } = await import('./workspace.service')

const client = {} as SupabaseClient<Database>

describe('listUserWorkspaces', () => {
    it('lists the memberships oldest first, without the expert sandbox, with the caller’s role and which have a subscription in force', async () => {
        mocks.selectMany.mockReset()
        mocks.selectMany.mockResolvedValueOnce({ data: [{ workspace_id: 7, role: 'member', box_scope: 'assigned' }, { workspace_id: 3, role: 'admin', box_scope: 'all' }, { workspace_id: 9, role: 'admin', box_scope: 'all' }], error: null }).mockResolvedValueOnce({
            data: [
                { id: 7, name: 'Side', icon_url: 'https://x/7.png', plan: 'pro', is_sandbox: false, subscription_status: 'trialing' },
                { id: 9, name: 'Sandbox', icon_url: '', plan: 'free', is_sandbox: true, subscription_status: null },
                { id: 3, name: null, icon_url: '', plan: 'free', is_sandbox: false, subscription_status: 'canceled' },
            ],
            error: null,
        })

        await expect(listUserWorkspaces(client, 'u1')).resolves.toEqual([
            { id: 3, name: null, iconUrl: '', plan: 'free', subscribed: false, role: 'admin', boxScope: 'all' },
            { id: 7, name: 'Side', iconUrl: 'https://x/7.png', plan: 'pro', subscribed: true, role: 'member', boxScope: 'assigned' },
        ])
        expect(mocks.selectMany.mock.calls[1][3]).toEqual({ id: [7, 3, 9] })
    })

    it('answers an empty list without a second read when the user has no membership', async () => {
        mocks.selectMany.mockReset().mockResolvedValueOnce({ data: [], error: null })
        await expect(listUserWorkspaces(client, 'u1')).resolves.toEqual([])
        expect(mocks.selectMany).toHaveBeenCalledTimes(1)
    })
})
