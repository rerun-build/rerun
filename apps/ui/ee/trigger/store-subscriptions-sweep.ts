import { logger, queue, schedules, task } from '@trigger.dev/sdk/v3'
import { sweepStoreSubscriptions } from '@/ee/services/store-billing.service'

type SweepPayload = {
    // Read the stores and log what would change, write nothing.
    dryRun?: boolean
    workspaceIds?: number[]
}

const storeSweepQueue = queue({ name: 'store-subscriptions', concurrencyLimit: 1 })

async function sweep(payload: SweepPayload) {
    const result = await sweepStoreSubscriptions(new Date(), payload)
    logger.log('store subscriptions sweep', result)
    return result
}

// Triggered by hand to replay one workspace against the store.
export const storeSubscriptionsSweep = task({
    id: 'store-subscriptions-sweep',
    queue: storeSweepQueue,
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async (payload: SweepPayload) => sweep(payload),
})

export const storeSubscriptionsSweepSchedule = schedules.task({
    id: 'store-subscriptions-sweep-hourly',
    cron: '17 * * * *',
    queue: storeSweepQueue,
    maxDuration: 300,
    // The next hour is the retry: every reading is a full state, a missed one costs nothing.
    retry: { maxAttempts: 1 },
    run: async (_payload, { ctx }) => {
        if (ctx.environment.type === 'DEVELOPMENT') return { skipped: 'development' }
        return sweep({})
    },
})
