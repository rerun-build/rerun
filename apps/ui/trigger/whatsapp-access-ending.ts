import { logger, queue, schedules, task } from '@trigger.dev/sdk/v3'
import { sweepAccessEnding } from '@/lib/whatsapp/access-ending'
import { createServiceRoleClient } from '@/supabase/serviceRole'

type AccessEndingPayload = {
    workspaceIds?: number[]
}

const accessEndingQueue = queue({ name: 'whatsapp-access-ending', concurrencyLimit: 1 })

async function sweep(payload: AccessEndingPayload) {
    const report = await sweepAccessEnding(createServiceRoleClient(), new Date(), payload.workspaceIds)
    logger.log('whatsapp access ending sweep', report)
    return report
}

export const whatsappAccessEndingSweep = task({
    id: 'whatsapp-access-ending-sweep',
    queue: accessEndingQueue,
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async (payload: AccessEndingPayload) => sweep(payload),
})

export const whatsappAccessEndingSchedule = schedules.task({
    id: 'whatsapp-access-ending-every-15-min',
    cron: '4,19,34,49 * * * *',
    queue: accessEndingQueue,
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async (_payload, { ctx }) => {
        if (ctx.environment.type === 'DEVELOPMENT') {
            logger.log('whatsapp access ending: skipped, dev environment')
            return null
        }
        if (ctx.environment.type !== 'PRODUCTION' && !process.env.WHATSAPP_REDIRECT_TO) {
            logger.error('whatsapp access ending: skipped, WHATSAPP_REDIRECT_TO is not set outside production')
            return null
        }
        return sweep({})
    },
})
