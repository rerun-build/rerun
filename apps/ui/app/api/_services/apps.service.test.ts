import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryTables } from '@/ee/test/memory-table'

const m = vi.hoisted(() => ({ requireWorkspaceContext: vi.fn(), retrieve: vi.fn(), addPaidSlot: vi.fn(), addTrialSlot: vi.fn() }))

vi.mock('@/app/api/_auth/ownership', async importOriginal => ({ ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()), requireWorkspaceContext: m.requireWorkspaceContext }))
vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({ ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()), stripe: { subscriptions: { retrieve: m.retrieve } } }))
vi.mock('@/lib/apps/stripe-slots', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/stripe-slots')>()), addPaidSlot: m.addPaidSlot, addTrialSlot: m.addTrialSlot }))

const { addAppSlot } = await import('./apps.service')

function useWorkspace(workspace: Record<string, unknown>) {
    const db = memoryTables({
        workspaces: { rows: [{ id: 7, boxes_archived_at: null, ...workspace }] },
        workspace_apps: { rows: [] },
        app_connections: { rows: [] },
        app_trial_claims: { rows: [] },
    })
    m.requireWorkspaceContext.mockResolvedValue({ workspace: { id: 7 }, supabase: db.client })
}

describe('addAppSlot', () => {
    beforeEach(() => vi.clearAllMocks())

    it('sells no slot to a workspace a store bills, which has no Stripe plan to put it on', async () => {
        useWorkspace({ stripe_subscription_id: 'sub_old', subscription_status: 'active', billing_provider: 'apple' })
        await expect(addAppSlot('linkedin', 'req-1')).rejects.toThrow('This plan is billed through the App Store.')
        expect(m.retrieve).not.toHaveBeenCalled()
        expect(m.addPaidSlot).not.toHaveBeenCalled()
    })

    it('still sells one on a Stripe plan', async () => {
        useWorkspace({ stripe_subscription_id: 'sub_1', subscription_status: 'active', billing_provider: 'stripe' })
        m.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [] } })
        await expect(addAppSlot('linkedin', 'req-1')).resolves.toEqual({ trialSlot: false })
        expect(m.addPaidSlot).toHaveBeenCalled()
    })
})
