import { logger, queue, schedules, task } from '@trigger.dev/sdk/v3'
import { pickLifecycleEmail, type LifecycleCandidate } from '@/ee/lib/lifecycle/decide'
import { loadLifecycleContext } from '@/ee/lib/lifecycle/discovery'
import { deliverLifecycleEmail } from '@/ee/lib/lifecycle/send'
import { lifecycleFloor, type LifecycleSequenceKey } from '@/ee/lib/lifecycle/sequences'
import { createServiceRoleClient } from '@/supabase/serviceRole'

type SweepPayload = {
    dryRun?: boolean
    userIds?: string[]
}

const lifecycleQueue = queue({ name: 'lifecycle-emails', concurrencyLimit: 1 })

async function sweep(payload: SweepPayload) {
    const supabase = createServiceRoleClient()
    const now = new Date()

    const context = await loadLifecycleContext(supabase, now, payload.userIds)
    const tally: Partial<Record<LifecycleSequenceKey, number>> = {}
    const skipped: string[] = []
    let sent = 0

    for (const snapshot of context.snapshots) {
        const candidate = pickLifecycleEmail(snapshot, now)
        if (!candidate) continue
        const user = context.users.get(candidate.userId)
        if (!user) continue
        tally[candidate.sequenceKey] = (tally[candidate.sequenceKey] ?? 0) + 1

        if (payload.dryRun) {
            logger.log('lifecycle: would send', { sequence: candidate.sequenceKey, userId: candidate.userId, agentId: candidate.agentId })
            continue
        }

        let result: Awaited<ReturnType<typeof deliverLifecycleEmail>>
        try {
            result = await deliverLifecycleEmail(supabase, {
                candidate,
                snapshot,
                user,
                workspace: context.workspaces.get(candidate.workspaceId),
                agentName: agentNameFor(context.agentNames, candidate),
                now,
            })
        } catch (err) {
            result = { sent: false, reason: err instanceof Error ? err.message : String(err) }
        }

        if (result.sent) sent++
        else skipped.push(`${candidate.sequenceKey}: ${result.reason}`)
    }

    logger.log('lifecycle sweep', { considered: context.snapshots.length, picked: tally, sent, skipped })
    return { considered: context.snapshots.length, picked: tally, sent, skipped }
}

function agentNameFor(names: Map<string, string>, candidate: LifecycleCandidate): string | null {
    if (candidate.agentName) return candidate.agentName
    return candidate.agentId ? (names.get(candidate.agentId) ?? null) : null
}

export const lifecycleSweep = task({
    id: 'lifecycle-sweep',
    queue: lifecycleQueue,
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async (payload: SweepPayload) => sweep(payload),
})

export const lifecycleSweepSchedule = schedules.task({
    id: 'lifecycle-sweep-every-15-min',
    cron: '*/15 * * * *',
    queue: lifecycleQueue,
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async (_payload, { ctx }) => {
        if (ctx.environment.type === 'DEVELOPMENT') {
            logger.log('lifecycle sweep: skipped, dev environment')
            return null
        }
        if (!lifecycleFloor()) {
            logger.error('lifecycle sweep: skipped, LIFECYCLE_EMAILS_START_AT is not set')
            return null
        }
        if (ctx.environment.type !== 'PRODUCTION' && !process.env.EMAIL_REDIRECT_TO) {
            logger.error('lifecycle sweep: skipped, EMAIL_REDIRECT_TO is not set outside production')
            return null
        }
        return sweep({})
    },
})
