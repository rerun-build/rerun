import { logger, queue, schedules, task } from '@trigger.dev/sdk/v3'
import { REWIND_RELEASED } from '@/lib/features'
import { buildWorkspaceRewind } from '@/lib/rewind/build'
import { lastCompletedWeek, rewindWeekStarting } from '@/lib/rewind/week'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll } from '@/supabase/supabase-helpers'

const BATCH_SIZE = 500

type BuildPayload = {
    workspaceId: number
    weekStart?: string
}

const rewindQueue = queue({ name: 'weekly-rewind', concurrencyLimit: 5 })

export const buildRewind = task({
    id: 'build-workspace-rewind',
    queue: rewindQueue,
    maxDuration: 600,
    retry: { maxAttempts: 2 },
    run: async ({ workspaceId, weekStart }: BuildPayload) => {
        const week = weekStart ? rewindWeekStarting(new Date(`${weekStart}T00:00:00.000Z`)) : lastCompletedWeek(new Date())
        const result = await buildWorkspaceRewind(createServiceRoleClient(), workspaceId, week)
        logger.log('rewind', { workspaceId, weekStart: week.weekStart, ...result })
        return result
    },
})

async function workspacesWithAgents(): Promise<number[]> {
    const supabase = createServiceRoleClient()
    const [{ data: agents }, { data: torndown }] = await Promise.all([
        selectAll(supabase, 'agents', ['workspace_id'] as const, { engine_agent_id: { notNull: true } }),
        selectAll(supabase, 'workspaces', ['id'] as const, { boxes_deleted_at: { notNull: true } }),
    ])
    const excluded = new Set((torndown ?? []).map(workspace => workspace.id))
    return [...new Set((agents ?? []).map(agent => agent.workspace_id))].filter(id => !excluded.has(id))
}

export const weeklyRewindSchedule = schedules.task({
    id: 'weekly-rewind-monday',
    cron: '0 5 * * 1',
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async (_payload, { ctx }) => {
        if (ctx.environment.type === 'DEVELOPMENT') {
            logger.log('weekly rewind: skipped, dev environment')
            return null
        }
        if (!REWIND_RELEASED) {
            logger.log('weekly rewind: skipped, feature not released')
            return null
        }
        const weekStart = lastCompletedWeek(new Date()).weekStart
        const workspaceIds = await workspacesWithAgents()
        for (let i = 0; i < workspaceIds.length; i += BATCH_SIZE) {
            await buildRewind.batchTrigger(
                workspaceIds.slice(i, i + BATCH_SIZE).map(workspaceId => ({
                    payload: { workspaceId, weekStart },
                    options: { idempotencyKey: `rewind-${workspaceId}-${weekStart}` },
                }))
            )
        }
        logger.log('weekly rewind: dispatched', { weekStart, workspaces: workspaceIds.length })
        return { weekStart, workspaces: workspaceIds.length }
    },
})
