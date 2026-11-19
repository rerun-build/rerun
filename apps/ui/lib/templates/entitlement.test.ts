import { describe, expect, it, vi } from 'vitest'

import { fakeSupabase } from '@/test/supabase-fake'
import { hasTemplateEntitlement, templateAccessByWorkspace } from './entitlement'
vi.mock('@moldwright/cloud/marketplace', async () => (await import('@/test/cloud-fakes')).CLOUD_MARKETPLACE)

const PAID = { id: 'tpl_1', pricing_model: 'one_time', creator_id: 'creator_1' }

describe('templateAccessByWorkspace', () => {
    it('tells an owned template apart from a lapsed, a refunded and an unknown one', async () => {
        const db = fakeSupabase(() => ({
            data: [
                { template_id: 'active', status: 'active' },
                { template_id: 'late', status: 'past_due' },
                { template_id: 'ended', status: 'canceled' },
                { template_id: 'refunded', status: 'refunded' },
                { template_id: 'odd', status: 'pending' },
            ],
        }))

        const access = await templateAccessByWorkspace(db.client, 42)

        expect(Object.fromEntries(access)).toEqual({ active: 'active', late: 'active', ended: 'lapsed', refunded: 'refunded', odd: 'none' })
        expect(db.chains[0].find(call => call.method === 'eq')?.args).toEqual(['workspace_id', 42])
    })

    it('answers an empty map when the read fails', async () => {
        const db = fakeSupabase(() => ({ data: null, error: { message: 'boom' } }))
        await expect(templateAccessByWorkspace(db.client, 42)).resolves.toEqual(new Map())
    })
})

describe('hasTemplateEntitlement', () => {
    it('entitles anyone to a free template without reading purchases', async () => {
        const db = fakeSupabase()
        await expect(hasTemplateEntitlement(db.client, 42, { ...PAID, pricing_model: 'free' })).resolves.toBe(true)
        expect(db.calls).toHaveLength(0)
    })

    it('entitles the author to their own template', async () => {
        const db = fakeSupabase()
        await expect(hasTemplateEntitlement(db.client, 42, PAID, 'creator_1')).resolves.toBe(true)
        expect(db.calls).toHaveLength(0)
    })

    it.each([['active'], ['past_due']])('entitles a workspace whose purchase is %s', async status => {
        const db = fakeSupabase(() => ({ data: { status } }))
        await expect(hasTemplateEntitlement(db.client, 42, PAID, 'buyer_1')).resolves.toBe(true)
    })

    it.each([['canceled'], ['refunded']])('refuses a workspace whose purchase is %s', async status => {
        const db = fakeSupabase(() => ({ data: { status } }))
        await expect(hasTemplateEntitlement(db.client, 42, PAID)).resolves.toBe(false)
    })

    it('refuses a workspace that never bought the template', async () => {
        const db = fakeSupabase(() => ({ data: null }))
        await expect(hasTemplateEntitlement(db.client, 42, PAID)).resolves.toBe(false)
    })

    it('does not mistake an anonymous viewer for the author of an authorless template', async () => {
        const db = fakeSupabase(() => ({ data: null }))
        await expect(hasTemplateEntitlement(db.client, 42, { ...PAID, creator_id: null }, null)).resolves.toBe(false)
    })
})
