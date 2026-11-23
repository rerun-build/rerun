import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Actor } from '@/app/api/_auth/access'
import { assertAgentAccess, assertAgentInWorkspace } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { fakeSupabase, tableResolver, writeMethodOf, type FakeSupabase } from '@/test/supabase-fake'
import { stripe } from '@/ee/lib/billing/stripe'
import { createLifetimeAddonsCheckout, removeLifetimeAddonSlot, resumeLifetimeAddons } from '@/ee/services/lifetime-addons.service'
import { deleteAccount, submitCheckpoint } from '@/lib/apps/linkup/client'
import { dropWakeTrigger, syncAppConnector, unbindAccount } from '@/lib/apps/bindings'
import { createTrigger } from '@/lib/engine/client'
import { addPaidSlot } from '@/lib/apps/stripe-slots'
import { addAppSlot, attachAgentToConnection, detachAgentFromConnection, getAgentAppAccounts, getAppsOverview, removeAppSlot, setAgentWakeEvents, submitAppCheckpoint } from './apps.service'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/api/_auth/access', () => ({ assertAgentAccess: vi.fn(), assertAgentInWorkspace: vi.fn() }))
vi.mock('@/app/api/_auth/ownership', () => ({
    AuthorizationError: class AuthorizationError extends Error {},
    requireWorkspaceContext: vi.fn(),
}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ getWorkspaceConnection: vi.fn() }))
vi.mock('@/lib/apps/bindings', () => ({ syncAppConnector: vi.fn(async () => 1), dropWakeTrigger: vi.fn(), unbindAccount: vi.fn(), unbindConnection: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ createTrigger: vi.fn() }))
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
vi.mock('@/lib/apps/linkup/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/apps/linkup/client')>()), submitCheckpoint: vi.fn(), deleteAccount: vi.fn() }))

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
    vi.mocked(assertAgentAccess).mockImplementation(async agentId => ({ actor: KEY_ACTOR, agent: { id: agentId } }) as never)
    vi.mocked(requireWorkspaceContext).mockRejectedValue(new Error('no browser session'))
})

describe('attachAgentToConnection', () => {
    it('binds the coworker to an account of the actor workspace, without a browser session', async () => {
        workspaceHoldsTheAccount(true)

        await attachAgentToConnection('linkedin', 'agent-1', 'conn-a', KEY_ACTOR)

        expect(assertAgentAccess).toHaveBeenCalledWith('agent-1', 'manage', KEY_ACTOR)
        expect(requireWorkspaceContext).not.toHaveBeenCalled()
        expect(supabase.chainsOn('app_connections')[0]).toContainEqual({ table: 'app_connections', method: 'eq', args: ['workspace_id', 7] })
        expect(supabase.writes('app_connection_agents')).toEqual([expect.objectContaining({ method: 'upsert', payload: { agent_id: 'agent-1', app_slug: 'linkedin', connection_id: 'conn-a' } })])
        expect(syncAppConnector).toHaveBeenCalledWith(supabase.client, 'agent-1', 'linkedin')
    })

    it('refuses an account the actor workspace does not hold', async () => {
        workspaceHoldsTheAccount(false)

        await expect(attachAgentToConnection('linkedin', 'agent-1', 'conn-elsewhere', KEY_ACTOR)).rejects.toThrow('accountNotFound')
        expect(supabase.writes('app_connection_agents')).toEqual([])
    })
})

describe('the accounts of a coworker', () => {
    const BINDINGS = [
        { agent_id: 'agent-1', app_slug: 'linkedin', connection_id: 'conn-a', wake_on_events: ['message_received'], trigger_slug: 'linkedin-events', created_at: '2026-11-01' },
        { agent_id: 'agent-1', app_slug: 'linkedin', connection_id: 'conn-b', wake_on_events: [], trigger_slug: null, created_at: '2026-11-02' },
    ]
    const CONNECTIONS = [
        { id: 'conn-a', workspace_id: 7, app_slug: 'linkedin', label: 'Ada', status: 'connected', provider_member_id: 'ada' },
        { id: 'conn-b', workspace_id: 7, app_slug: 'linkedin', label: 'Bea', status: 'connected', provider_member_id: 'bea-martin' },
    ]

    function coworker(bindings: object[] = BINDINGS) {
        supabase = fakeSupabase(tableResolver({ app_connection_agents: bindings, app_connections: CONNECTIONS }))
        vi.mocked(requireWorkspaceContext).mockResolvedValue({ workspace: { id: 7 }, userId: 'u-1', supabase: supabase.client } as never)
        vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client)
        vi.mocked(assertAgentInWorkspace).mockImplementation(async agentId => ({ id: agentId, engine_agent_id: 'engine-1' }) as never)
        vi.mocked(createTrigger).mockImplementation(async (_conn, _agent, { name }) => ({ slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, ''), token: 'tok' }) as never)
    }

    it('are listed in the order it got them, each with its own wake-ups', async () => {
        coworker()
        expect(await getAgentAppAccounts('linkedin', 'agent-1')).toEqual([
            { connectionId: 'conn-a', label: 'Ada', status: 'connected', wakeOnEvents: ['message_received'] },
            { connectionId: 'conn-b', label: 'Bea', status: 'connected', wakeOnEvents: [] },
        ])
    })

    it('wake it through a trigger each, the first under the name it always had', async () => {
        coworker()
        await setAgentWakeEvents('linkedin', 'agent-1', 'conn-b', ['accepted_invitation'])
        expect(vi.mocked(createTrigger).mock.calls[0][2].name).toBe('LinkedIn events (bea-martin)')
        expect(supabase.writes('app_connection_agents')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ wake_on_events: ['accepted_invitation'], trigger_slug: 'linkedin-events-bea-martin', trigger_token: 'tok' }) })])
        expect(supabase.chainsOn('app_connection_agents').at(-1)).toContainEqual({ table: 'app_connection_agents', method: 'eq', args: ['connection_id', 'conn-b'] })

        vi.mocked(createTrigger).mockClear()
        coworker([BINDINGS[1]])
        await setAgentWakeEvents('linkedin', 'agent-1', 'conn-b', ['accepted_invitation'])
        expect(vi.mocked(createTrigger).mock.calls[0][2].name).toBe('LinkedIn events')
    })

    it('change their events without a new trigger, and lose only their own when they are switched off', async () => {
        coworker()
        await setAgentWakeEvents('linkedin', 'agent-1', 'conn-a', ['message_received', 'invitation_received', 'not_an_event'])
        expect(createTrigger).not.toHaveBeenCalled()
        expect(supabase.writes('app_connection_agents')[0].payload).toMatchObject({ wake_on_events: ['message_received', 'invitation_received'], trigger_slug: 'linkedin-events' })

        await setAgentWakeEvents('linkedin', 'agent-1', 'conn-a', [])
        expect(dropWakeTrigger).toHaveBeenCalledExactlyOnceWith(supabase.client, 7, 'agent-1', 'conn-a', 'linkedin')
        await expect(setAgentWakeEvents('linkedin', 'agent-1', 'conn-c', ['message_received'])).rejects.toMatchObject({ code: 'appPickAccountFirst' })
    })

    it('are taken off one at a time', async () => {
        coworker()
        await detachAgentFromConnection('linkedin', 'agent-1', 'conn-a', KEY_ACTOR)
        expect(assertAgentAccess).toHaveBeenCalledWith('agent-1', 'manage', KEY_ACTOR)
        expect(unbindAccount).toHaveBeenCalledExactlyOnceWith(supabase.client, 7, 'agent-1', 'conn-a', 'linkedin')
        expect(syncAppConnector).toHaveBeenCalledWith(supabase.client, 'agent-1', 'linkedin')
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

// Linkup keeps one account per WhatsApp number or LinkedIn profile and hands it back to a second
// sign-in, which the unique index on provider_account_id then refuses (RER-171).
describe('an account Linkup already holds', () => {
    const CONNECTING = { id: 'conn-new', workspace_id: 7, app_slug: 'whatsapp', status: 'connecting', provider_account_id: 'acc-pending', provider_webhook_id: null, label: null }

    function linkupHandsBack(accountId: string, otherRows: object[]) {
        const rows = tableResolver({ app_connections: [CONNECTING, ...otherRows] })
        supabase = fakeSupabase((table, calls) => {
            const update = calls.find(call => call.method === 'update')
            if (update && 'provider_account_id' in (update.args[0] as object)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint "app_connections_provider_account_idx"' } }
            return rows(table, calls)
        })
        vi.mocked(requireWorkspaceContext).mockResolvedValue({ workspace: { id: 7 }, userId: 'u-1', supabase: supabase.client } as never)
        vi.mocked(submitCheckpoint).mockResolvedValue({ status: 'connected', accountId })
    }

    it('says the account is connected to another workspace when this one does not hold it', async () => {
        linkupHandsBack('acc-taken', [{ id: 'conn-elsewhere', workspace_id: 8, app_slug: 'whatsapp', status: 'connected', provider_account_id: 'acc-taken', label: '+33 6 00 00 00 00' }])

        await expect(submitAppCheckpoint('whatsapp', 'conn-new')).rejects.toMatchObject({ reason: 'duplicate', code: 'appAccountInOtherWorkspace', params: { provider: 'WhatsApp' } })
        expect(supabase.writes('app_connections')).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ status: 'deleted' }) }))
        expect(deleteAccount).not.toHaveBeenCalled()
    })

    it('says the account is already in this workspace when one of its connections holds it', async () => {
        linkupHandsBack('acc-taken', [{ id: 'conn-old', workspace_id: 7, app_slug: 'whatsapp', status: 'connected', provider_account_id: 'acc-taken', label: '+33 6 00 00 00 00' }])

        await expect(submitAppCheckpoint('whatsapp', 'conn-new')).rejects.toMatchObject({ reason: 'duplicate', code: 'appAccountAlreadyConnected', params: { provider: 'WhatsApp' } })
        expect(deleteAccount).not.toHaveBeenCalled()
    })
})
