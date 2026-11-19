import { task } from '@trigger.dev/sdk/v3'
import { taskLogger as logger } from '@moldwright/cloud/tasks'
import { prefillExpertFromProfile } from '@/lib/experts/prefill'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { expertScrapeQueue } from './expert-queue'

type PrefillExpertApplicationPayload = { expertId: string }

export const prefillExpertApplicationTask = task({
    id: 'prefill-expert-application',
    queue: expertScrapeQueue,
    maxDuration: 600,
    retry: { maxAttempts: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, factor: 2 },
    run: (payload: PrefillExpertApplicationPayload) => prefillExpertApplicationRun(payload),
})

export async function prefillExpertApplicationRun({ expertId }: PrefillExpertApplicationPayload) {
    const supabase = createServiceRoleClient()
    const result = await prefillExpertFromProfile(supabase, expertId)

    if (!result.ok) {
        logger.info('expert prefill skipped', { expertId, reason: result.reason })
        return result
    }

    logger.info('expert prefilled', { expertId, slug: result.slug, source: result.source })
    return result
}
