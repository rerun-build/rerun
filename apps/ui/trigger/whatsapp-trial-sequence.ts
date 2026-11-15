import { logger, queue, schedules, task } from '@trigger.dev/sdk/v3'
import { sweepTrialSequence } from '@/lib/whatsapp/trial-sequence'
import { createServiceRoleClient } from '@/supabase/serviceRole'

type TrialSequencePayload = {
    workspaceIds?: number[]
}

const trialSequenceQueue = queue({ name: 'whatsapp-trial-sequence', concurrencyLimit: 1 })

async function sweep(payload: TrialSequencePayload) {
    const report = await sweepTrialSequence(createServiceRoleClient(), new Date(), payload.workspaceIds)
    logger.log('whatsapp trial sequence sweep', report)
    return report
}

export const whatsappTrialSequenceSweep = task({
    id: 'whatsapp-trial-sequence-sweep',
    queue: trialSequenceQueue,
    maxDuration: 600,
    retry: { maxAttempts: 1 },
    run: async (payload: TrialSequencePayload) => sweep(payload),
})

export const whatsappTrialSequenceSchedule = schedules.task({
    id: 'whatsapp-trial-sequence-every-15-min',
    cron: '9,24,39,54 * * * *',
    queue: trialSequenceQueue,
    maxDuration: 600,
    retry: { maxAttempts: 1 },
    run: async (_payload, { ctx }) => {
        if (ctx.environment.type === 'DEVELOPMENT') {
            logger.log('whatsapp trial sequence: skipped, dev environment')
            return null
        }
        if (ctx.environment.type !== 'PRODUCTION' && !process.env.WHATSAPP_REDIRECT_TO) {
            logger.error('whatsapp trial sequence: skipped, WHATSAPP_REDIRECT_TO is not set outside production')
            return null
        }
        return sweep({})
    },
})
