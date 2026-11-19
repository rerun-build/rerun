import { captureServer } from '@moldwright/analytics/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GettingStartedItem } from '@/lib/onboarding/getting-started'
import { fakeSupabase, writeMethodOf, type FakeSupabase, type SupabaseResult } from '@/test/supabase-fake'
import { resolveWorkspaceOwner } from './workspace-owner.service'
import { extendTrial } from '@moldwright/cloud/billing.server'
import { grantGettingStartedReward, markGettingStarted, reportGettingStartedSteps } from './getting-started.service'
vi.mock('@moldwright/cloud/phone', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_PHONE }))

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ listConnections: vi.fn(), listSchedules: vi.fn() }))
vi.mock('./workspace-engine.service', () => ({ authenticateEngineToken: vi.fn(), findWorkspaceEngine: vi.fn() }))
vi.mock('@moldwright/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))
vi.mock('@moldwright/cloud/billing.server', () => ({ extendTrial: vi.fn(), subscriptionHasCard: vi.fn() }))
vi.mock('./workspace-owner.service', () => ({ resolveWorkspaceOwner: vi.fn() }))
vi.mock('@moldwright/analytics/server', async importOriginal => ({ ...(await importOriginal<typeof import('@moldwright/analytics/server')>()), captureServer: vi.fn() }))

const WORKSPACE_ID = 42
const COMPLETE = new Set<GettingStartedItem>(['first_agent', 'ai_provider', 'invite', 'schedule', 'payment_method'])

let workspace: { subscription_status: string | null; stripe_subscription_id: string | null } | null
let ownerPhone: { verified_at: string | null; skipped_at: string | null; unverifiable_at?: string | null } | null
let claim: SupabaseResult
let unreported: { item: string; done_at: string }[]
let db: FakeSupabase

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    workspace = { subscription_status: 'trialing', stripe_subscription_id: 'sub_1' }
    ownerPhone = null
    claim = { error: null }
    unreported = []
    db = fakeSupabase((table, calls) => {
        if (table === 'workspaces') return { data: workspace }
        if (table === 'user_phones') return { data: ownerPhone }
        if (table === 'workspace_getting_started' && writeMethodOf(calls) === 'insert') return claim
        if (table === 'workspace_getting_started' && writeMethodOf(calls) === 'update') return { data: unreported.splice(0) }
        return undefined
    })
    vi.mocked(extendTrial).mockResolvedValue(true as never)
    vi.mocked(resolveWorkspaceOwner).mockResolvedValue({ userId: 'user_1', email: 'owner@rerun.test' })
})

function rewardWrites() {
    return db.writes('workspace_getting_started')
}

describe('grantGettingStartedReward', () => {
    it('does nothing once the reward is already claimed', async () => {
        await grantGettingStartedReward(db.client, WORKSPACE_ID, new Set([...COMPLETE, 'reward']))
        expect(db.calls).toHaveLength(0)
    })

    it('does nothing while a step is missing', async () => {
        await grantGettingStartedReward(db.client, WORKSPACE_ID, new Set<GettingStartedItem>(['first_agent', 'ai_provider', 'invite', 'schedule']))
        expect(db.calls).toHaveLength(0)
    })

    it('waits on the phone of an owner that skipped it', async () => {
        ownerPhone = { verified_at: null, skipped_at: '2026-10-19T00:00:00Z' }
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)
        expect(rewardWrites()).toEqual([])
        expect(extendTrial).not.toHaveBeenCalled()
    })

    it("reads the owner's phone, whichever member asked", async () => {
        ownerPhone = { verified_at: null, skipped_at: null }
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)
        const phoneRead = db.chainsOn('user_phones')[0]
        expect(phoneRead.find(call => call.method === 'eq')?.args).toEqual(['user_id', 'user_1'])
        expect(extendTrial).not.toHaveBeenCalled()
    })

    it.each([
        ['a paid workspace', { subscription_status: 'active', stripe_subscription_id: 'sub_1' }],
        ['a trial without a Stripe subscription', { subscription_status: 'trialing', stripe_subscription_id: null }],
    ])('claims nothing for %s', async (_label, row) => {
        workspace = row
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)
        expect(rewardWrites()).toEqual([])
        expect(extendTrial).not.toHaveBeenCalled()
    })

    it('extends nothing when another tab already holds the claim', async () => {
        claim = { error: { code: '23505', message: 'duplicate key' } }
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)
        expect(extendTrial).not.toHaveBeenCalled()
    })

    it('claims the reward before extending the trial and keeps the claim', async () => {
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)

        expect(rewardWrites()).toEqual([expect.objectContaining({ method: 'insert', payload: { workspace_id: WORKSPACE_ID, item: 'reward' } })])
        expect(extendTrial).toHaveBeenCalledWith('sub_1', 3, 'getting-started-reward-ws-42')
        expect(captureServer).toHaveBeenCalledWith('owner@rerun.test', 'trial_extended', { days: 3, source: 'getting_started' }, expect.objectContaining({ uuid: expect.any(String) }))
    })

    it("counts the owner's verified phone as the step done", async () => {
        ownerPhone = { verified_at: '2026-10-19T00:00:00Z', skipped_at: null }
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)
        expect(extendTrial).toHaveBeenCalledWith('sub_1', 3, 'getting-started-reward-ws-42')
    })

    it("counts the owner's number in a country no code reaches as the step done", async () => {
        ownerPhone = { verified_at: null, skipped_at: '2026-10-21T00:00:00Z', unverifiable_at: '2026-10-21T00:00:00Z' }
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)
        expect(extendTrial).toHaveBeenCalledWith('sub_1', 3, 'getting-started-reward-ws-42')
    })

    it('asks nothing of a workspace whose owner cannot be resolved', async () => {
        vi.mocked(resolveWorkspaceOwner).mockResolvedValue(null)
        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)
        expect(db.chainsOn('user_phones')).toHaveLength(0)
        expect(extendTrial).toHaveBeenCalledWith('sub_1', 3, 'getting-started-reward-ws-42')
    })

    it('releases the claim when Stripe declines to extend', async () => {
        vi.mocked(extendTrial).mockResolvedValue(false as never)

        await grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)

        const release = rewardWrites().find(write => write.method === 'delete')
        expect(release?.filters.map(call => call.args)).toEqual([
            ['workspace_id', WORKSPACE_ID],
            ['item', 'reward'],
        ])
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('releases the claim when the extension throws', async () => {
        vi.mocked(extendTrial).mockRejectedValue(new Error('stripe down'))

        await expect(grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)).resolves.toBeUndefined()

        expect(rewardWrites().map(write => write.method)).toEqual(['insert', 'delete'])
        expect(captureServer).not.toHaveBeenCalled()
    })

    it('keeps the claim when only the analytics capture fails', async () => {
        vi.mocked(captureServer).mockRejectedValue(new Error('posthog down'))

        await expect(grantGettingStartedReward(db.client, WORKSPACE_ID, COMPLETE)).resolves.toBeUndefined()

        expect(rewardWrites().map(write => write.method)).toEqual(['insert'])
    })
})

describe('reportGettingStartedSteps', () => {
    it('reports a step a trigger ticked, dated from when it was done', async () => {
        unreported = [{ item: 'first_agent', done_at: '2026-10-08T09:00:00.000Z' }]
        await reportGettingStartedSteps(db.client, WORKSPACE_ID)

        expect(captureServer).toHaveBeenCalledTimes(1)
        expect(captureServer).toHaveBeenCalledWith('owner@rerun.test', 'getting_started_step_completed', { step: 'first_agent' }, { uuid: expect.any(String), timestamp: new Date('2026-10-08T09:00:00.000Z') })
    })

    it('only claims the steps nobody reported yet', async () => {
        await reportGettingStartedSteps(db.client, WORKSPACE_ID)

        const [claimed] = db.writes('workspace_getting_started')
        expect(claimed.payload).toEqual({ reported_at: expect.any(String) })
        expect(claimed.filters.map(filter => [filter.method, ...filter.args])).toEqual(
            expect.arrayContaining([
                ['eq', 'workspace_id', WORKSPACE_ID],
                ['is', 'reported_at', null],
            ]),
        )
    })

    it('reports nothing the second time around', async () => {
        unreported = [{ item: 'invite', done_at: '2026-10-08T09:00:00.000Z' }]
        await reportGettingStartedSteps(db.client, WORKSPACE_ID)
        await reportGettingStartedSteps(db.client, WORKSPACE_ID)

        expect(captureServer).toHaveBeenCalledTimes(1)
    })

    it('never fails its caller when analytics does', async () => {
        unreported = [{ item: 'schedule', done_at: '2026-10-08T09:00:00.000Z' }]
        vi.mocked(captureServer).mockRejectedValueOnce(new Error('posthog down'))

        await expect(reportGettingStartedSteps(db.client, WORKSPACE_ID)).resolves.toBeUndefined()
    })
})

describe('markGettingStarted', () => {
    it('reports the step it just wrote', async () => {
        unreported = [{ item: 'payment_method', done_at: '2026-10-08T09:00:00.000Z' }]
        await markGettingStarted(db.client, WORKSPACE_ID, ['payment_method'])

        expect(db.writes('workspace_getting_started').map(write => write.method)).toEqual(['upsert', 'update'])
        expect(captureServer).toHaveBeenCalledWith('owner@rerun.test', 'getting_started_step_completed', { step: 'payment_method' }, expect.anything())
    })
})
