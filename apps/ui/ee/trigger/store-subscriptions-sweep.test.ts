import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runContext } from '@/test/trigger-sdk'

const sweepStoreSubscriptions = vi.fn()

vi.mock('@trigger.dev/sdk/v3', async () => (await import('@/test/trigger-sdk')).triggerSdkMock())
vi.mock('@/ee/services/store-billing.service', () => ({ sweepStoreSubscriptions: (...args: unknown[]) => sweepStoreSubscriptions(...args) }))

const { storeSubscriptionsSweep, storeSubscriptionsSweepSchedule } = await import('./store-subscriptions-sweep')

type Runnable = { run: (payload: unknown, context: unknown) => Promise<unknown> }

describe('store subscriptions sweep', () => {
    beforeEach(() => {
        sweepStoreSubscriptions.mockReset().mockResolvedValue({ considered: 2, applied: 1, unchanged: 1, failed: [] })
    })

    it('runs every hour outside development', async () => {
        expect(await (storeSubscriptionsSweepSchedule as unknown as Runnable).run({}, runContext('PRODUCTION'))).toEqual({ considered: 2, applied: 1, unchanged: 1, failed: [] })
        expect(await (storeSubscriptionsSweepSchedule as unknown as Runnable).run({}, runContext('STAGING'))).toMatchObject({ considered: 2 })
        expect(sweepStoreSubscriptions).toHaveBeenCalledTimes(2)
    })

    it('stays off in development, where the env may point at production', async () => {
        expect(await (storeSubscriptionsSweepSchedule as unknown as Runnable).run({}, runContext('DEVELOPMENT'))).toEqual({ skipped: 'development' })
        expect(sweepStoreSubscriptions).not.toHaveBeenCalled()
    })

    it('replays chosen workspaces by hand, dry or not', async () => {
        await (storeSubscriptionsSweep as unknown as Runnable).run({ dryRun: true, workspaceIds: [7] }, runContext('PRODUCTION'))
        expect(sweepStoreSubscriptions).toHaveBeenCalledWith(expect.any(Date), { dryRun: true, workspaceIds: [7] })
    })
})
