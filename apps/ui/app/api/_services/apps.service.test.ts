import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { assertAgentAccess } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'
import { stripe } from '@/ee/lib/billing/stripe'
import { createLifetimeAddonsCheckout, removeLifetimeAddonSlot, resumeLifetimeAddons } from '@/ee/services/lifetime-addons.service'
import { addPaidSlot } from '@/lib/apps/stripe-slots'
import { addAppSlot, attachAgentToConnection, getAppsOverview, removeAppSlot } from './apps.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({ assertAgentAccess: vi.fn(), assertAgentInWorkspace: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({
    AuthorizationError: class AuthorizationError extends Error {},
    requireWorkspaceContext: vi.fn(),
}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/ee/lib/billing/stripe', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ee/lib/billing/stripe')>()),
    stripe: (await import('@/ee/test/stripe-fake')).fakeStripe(),
}))
vi.mock('@/ee/services/lifetime-addons.service', () => ({
    adoptPendingLifetimeAddonsSubscription: vi.fn(async () => false),
    createLifetimeAddonsCheckout: vi.fn(async () => 'https://checkout.stripe.test/cs_1'),
    removeLifetimeAddonSlot: vi.fn(),
    resumeLifetimeAddons: vi.fn(),
    settleLifetimeAddonsCheckout: vi.fn(),
}))
vi.mock('@/lib/apps/stripe-slots', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/stripe-slots')>()), addPaidSlot: vi.fn(), addTrialSlot: vi.fn() }))
vi.mock('@/lib/apps/analytics', () => ({ reportWorkspaceEvent: vi.fn() }))

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

type WorkspaceRow = { plan: string; stripe_subscription_id: string | null; stripe_addons_subscription_id: string | null; subscription_status: string; boxes_archived_at: string | null }

const LIFETIME: WorkspaceRow = { plan: 'lifetime', stripe_subscription_id: null, stripe_addons_subscription_id: null, subscription_status: 'active', boxes_archived_at: null }

function slotsSubscription(status: string, linkedinSlots: number, fields: Record<string, unknown> = {}) {
    return { id: 'sub_addons', status, cancel_at_period_end: false, metadata: { kind: 'lifetime_addons' }, items: { data: [{ id: 'si_1', price: { id: 'price_linkedin_slot' }, quantity: linkedinSlots, current_period_end: 1_800_000_000 }] }, ...fields }
}

function useWorkspace(row: WorkspaceRow, connections: { id: string; status: string; pause_reason: string | null; created_at?: string }[] = []) {
    supabase = fakeSupabase(table => {
        if (table === 'workspaces') return { data: row }
        if (table === 'app_connections') return { data: connections }
        return undefined
    })
    vi.mocked(requireWorkspaceContext).mockResolvedValue({ workspace: { id: 7 }, supabase: supabase.client } as never)
}

describe('slots of a lifetime workspace', () => {
    it('sends its first slot to Checkout, with the free trial', async () => {
        useWorkspace(LIFETIME)

        await expect(addAppSlot('linkedin', 'req-1')).resolves.toEqual({ trialSlot: false, checkoutUrl: 'https://checkout.stripe.test/cs_1' })
        expect(createLifetimeAddonsCheckout).toHaveBeenCalledWith('linkedin', 'linkedin_slot', 'req-1', { trial: true })
    })

    it('offers no second trial once a slots subscription has ended', async () => {
        useWorkspace({ ...LIFETIME, stripe_addons_subscription_id: 'sub_old' })
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(slotsSubscription('canceled', 1) as never)

        await addAppSlot('linkedin', 'req-1')
        expect(createLifetimeAddonsCheckout).toHaveBeenCalledWith('linkedin', 'linkedin_slot', 'req-1', { trial: false })
    })

    it('tells the overview to start with Checkout', async () => {
        useWorkspace(LIFETIME)

        await expect(getAppsOverview('linkedin')).resolves.toMatchObject({ subscribed: true, lifetime: true, slotsCheckout: true, slotsCheckoutTrialDays: 5, allowance: 'buy_slot' })
    })

    it('sells nothing to an AppSumo workspace', async () => {
        useWorkspace({ ...LIFETIME, plan: 'lifetime_restricted' })

        await expect(addAppSlot('linkedin', 'req-1')).rejects.toMatchObject({ reason: 'not_entitled' })
        expect(createLifetimeAddonsCheckout).not.toHaveBeenCalled()
    })

    it('holds one slot per app while its trial runs', async () => {
        useWorkspace({ ...LIFETIME, stripe_addons_subscription_id: 'sub_addons' })
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(slotsSubscription('trialing', 1) as never)

        await expect(addAppSlot('linkedin', 'req-1')).rejects.toMatchObject({ reason: 'needs_slot', code: 'appSlotsTrialOneSlot' })
    })

    it('bills one more slot on its slots subscription once paid', async () => {
        useWorkspace({ ...LIFETIME, stripe_addons_subscription_id: 'sub_addons' })
        const subscription = slotsSubscription('active', 1)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscription as never)

        await expect(addAppSlot('linkedin', 'req-1')).resolves.toEqual({ trialSlot: false, checkoutUrl: null })
        expect(addPaidSlot).toHaveBeenCalledWith(subscription, 'linkedin_slot', 'slot-req-1')
    })

    it('keeps the slot given back instead of billing a second one', async () => {
        useWorkspace({ ...LIFETIME, stripe_addons_subscription_id: 'sub_addons' })
        const ending = slotsSubscription('active', 1, { cancel_at_period_end: true })
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(ending as never)
        vi.mocked(resumeLifetimeAddons).mockResolvedValue(slotsSubscription('active', 1) as never)

        await expect(addAppSlot('linkedin', 'req-1')).resolves.toEqual({ trialSlot: false, checkoutUrl: null })
        expect(resumeLifetimeAddons).toHaveBeenCalledWith(ending)
        expect(addPaidSlot).not.toHaveBeenCalled()
    })

    it('gives back a slot no account holds', async () => {
        useWorkspace({ ...LIFETIME, stripe_addons_subscription_id: 'sub_addons' }, [{ id: 'c1', status: 'connected', pause_reason: null }])
        const subscription = slotsSubscription('active', 2)
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(subscription as never)

        await removeAppSlot('linkedin')
        expect(removeLifetimeAddonSlot).toHaveBeenCalledWith(subscription, 'linkedin_slot')
    })

    it('refuses to give back a slot an account holds', async () => {
        useWorkspace({ ...LIFETIME, stripe_addons_subscription_id: 'sub_addons' }, [{ id: 'c1', status: 'connected', pause_reason: null }])
        vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue(slotsSubscription('active', 1) as never)

        await expect(removeAppSlot('linkedin')).rejects.toMatchObject({ code: 'appSlotInUse' })
        expect(removeLifetimeAddonSlot).not.toHaveBeenCalled()
    })
})
