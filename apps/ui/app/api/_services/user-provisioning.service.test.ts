import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, type FakeSupabase } from '@/test/supabase-fake'

const payloads = (client: FakeSupabase) => client.writes('user_phones').map(write => write.payload)

const grantRerunTopup = vi.fn()
vi.mock('@rerun/cloud/billing.server', () => ({ grantRerunTopup: (...args: unknown[]) => grantRerunTopup(...args) }))
vi.mock('@rerun/cloud/illustrations', () => ({ ILLUSTRATION_ENTRIES: [] }))

let service = fakeSupabase()
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => service.client }))

const { provisionUser } = await import('./user-provisioning.service')

const account = { id: 'user-1' } as User

// The request client only reads the users row; the service role answers the stamp with the row it wrote.
const existing = (signedUpAt: string | null) => fakeSupabase(table => (table === 'users' ? { data: { id: 'user-1', workspace_id: 7, signed_up_at: signedUpAt } } : undefined))
const stampLands = () => {
    service = fakeSupabase(table => (table === 'users' ? { data: [{ id: 'user-1' }] } : undefined))
}

beforeEach(() => {
    grantRerunTopup.mockReset()
    stampLands()
})

describe('provisionUser and the phone step', () => {
    it('stamps a row left without its signup, with the phone step and the allowance, once', async () => {
        expect(await provisionUser(existing(null).client, account, { phoneStep: true, priceArm: null })).toEqual({ signedUp: true })

        expect(payloads(service)).toEqual([{ user_id: 'user-1' }])
        expect(grantRerunTopup).toHaveBeenCalledTimes(1)
    })

    it('asks nothing of an account that arrives by invite or from the mobile app', async () => {
        expect(await provisionUser(existing(null).client, account, { phoneStep: false, priceArm: null })).toEqual({ signedUp: true })

        expect(payloads(service)).toEqual([])
    })

    it('never asks an account that already signed up', async () => {
        await provisionUser(existing('2026-09-01T00:00:00Z').client, account, { phoneStep: true, priceArm: null })

        expect(payloads(service)).toEqual([])
    })

    it('requires it from a new account, stamped and credited as it is born', async () => {
        service = fakeSupabase(table => (table === 'workspaces' ? { data: { id: 7 } } : undefined))
        const request = fakeSupabase()

        expect(await provisionUser(request.client, account, { phoneStep: true, priceArm: null })).toEqual({ signedUp: true })

        expect(payloads(service)).toEqual([{ user_id: 'user-1' }])
        expect(service.writes('users').map(write => write.payload)).toEqual([expect.objectContaining({ signed_up_at: expect.any(String) })])
        expect(grantRerunTopup).toHaveBeenCalledWith(7, expect.any(Number))
    })

    it('writes the users row with the service role, never through the request client', async () => {
        service = fakeSupabase(table => (table === 'workspaces' ? { data: { id: 7 } } : undefined))
        const request = fakeSupabase()

        await provisionUser(request.client, account, { phoneStep: false, priceArm: null })

        expect(request.writes('users')).toEqual([])
        expect(service.writes('users').map(write => write.payload)).toEqual([expect.objectContaining({ id: 'user-1', workspace_id: 7 })])
        expect(service.writes('workspace_members').map(write => write.payload)).toEqual([{ user_id: 'user-1', workspace_id: 7, role: 'admin' }])
    })
})

describe('provisionUser and the price test', () => {
    const workspaceInserts = () => service.writes('workspaces').filter(write => write.method === 'insert').map(write => write.payload)

    it('freezes the arm drawn for this request on the workspace it creates', async () => {
        service = fakeSupabase(table => (table === 'workspaces' ? { data: { id: 7 } } : undefined))

        await provisionUser(fakeSupabase().client, account, { phoneStep: true, priceArm: '29' })

        expect(workspaceInserts()).toEqual([expect.objectContaining({ price_arm: '29' })])
    })

    it('leaves a workspace out of the test when no arm was drawn', async () => {
        service = fakeSupabase(table => (table === 'workspaces' ? { data: { id: 7 } } : undefined))

        await provisionUser(fakeSupabase().client, account, { phoneStep: false, priceArm: null })

        expect(workspaceInserts()).toEqual([expect.objectContaining({ price_arm: null })])
    })
})

describe('provisionUser on an install without the illustration library', () => {
    it('creates the workspace with no icon rather than a link to a missing file', async () => {
        service = fakeSupabase(table => (table === 'workspaces' ? { data: { id: 7 } } : undefined))

        await provisionUser(fakeSupabase().client, account, { phoneStep: false, priceArm: null })

        const inserts = service.writes('workspaces').filter(write => write.method === 'insert').map(write => write.payload)
        expect(inserts).toEqual([expect.objectContaining({ icon_url: null })])
    })
})
