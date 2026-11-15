import { logger, queue, schedules, task } from '@trigger.dev/sdk/v3'
import { updateConnection } from '@/lib/apps/connections'
import { unbindAgent } from '@/lib/apps/bindings'
import { deleteAccount, listAccounts } from '@/lib/apps/linkup/client'
import { linkupNamespace } from '@/lib/apps/linkup/namespace'
import { LINKUP_ACCOUNT_MONTHLY_USD } from '@rerun/cloud/supplier-costs'
import { CONNECTING_GRACE_MS, accountsToDelete } from '@/lib/apps/reconcile'
import { linkupPlatforms } from '@/lib/apps/registry'
import { sweepSubscriberTrials } from '@/lib/apps/trials'
import { SLOT_HOLDING_STATUSES, isAppSlug } from '@/lib/apps/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectMany } from '@/supabase/supabase-helpers'

const paidAppsQueue = queue({ name: 'paid-apps', concurrencyLimit: 1 })

export const paidAppTrialsSchedule = schedules.task({
    id: 'paid-app-trials-hourly',
    cron: '23 * * * *',
    queue: paidAppsQueue,
    maxDuration: 300,
    retry: { maxAttempts: 1 },
    run: async (_payload, { ctx }) => {
        if (ctx.environment.type !== 'PRODUCTION') {
            logger.log('paid app trials: skipped, not production')
            return null
        }
        const report = await sweepSubscriberTrials(createServiceRoleClient(), new Date())
        logger.log('paid app trials', report)
        return report
    },
})

type ReconcilePayload = { dryRun?: boolean }

async function reconcile({ dryRun = false }: ReconcilePayload) {
    const supabase = createServiceRoleClient()
    const now = new Date()
    const accounts = await listAccounts()
    const { data: connections } = await selectAll(supabase, 'app_connections', ['id', 'workspace_id', 'app_slug', 'provider_account_id', 'status', 'pause_reason', 'label', 'updated_at'] as const, { provider_account_id: { notNull: true } })
    const verdicts = accountsToDelete(accounts, connections ?? [], now, linkupNamespace(), linkupPlatforms())
    const rowOf = new Map((connections ?? []).map(connection => [connection.id, connection]))

    const failed: string[] = []
    if (!dryRun) {
        for (const verdict of verdicts) {
            try {
                await deleteAccount(verdict.accountId)
                const row = verdict.connectionId ? rowOf.get(verdict.connectionId) : undefined
                if (!row) continue
                if (verdict.reason === 'unpaid_pause') {
                    const { data: bindings } = await selectMany(supabase, 'app_connection_agents', ['agent_id'] as const, { connection_id: row.id })
                    if (isAppSlug(row.app_slug)) for (const binding of bindings ?? []) await unbindAgent(supabase, row.workspace_id, binding.agent_id, row.app_slug)
                    await updateConnection(supabase, row.id, { status: 'deleted', pause_reason: 'unpaid_pause' })
                }
                if (verdict.reason === 'stale_connect') await updateConnection(supabase, row.id, row.label ? { status: 'needs_reconnect' } : { status: 'deleted' })
            } catch (err) {
                failed.push(`${verdict.accountId}: ${err instanceof Error ? err.message : String(err)}`)
            }
        }

        const cutoff = new Date(now.getTime() - CONNECTING_GRACE_MS).toISOString()
        const { data: stuck } = await selectAll(supabase, 'app_connections', ['id', 'label'] as const, { status: 'connecting', provider_account_id: { isNull: true }, updated_at: { lt: cutoff } })
        for (const row of stuck ?? []) await updateConnection(supabase, row.id, row.label ? { status: 'needs_reconnect' } : { status: 'deleted' })
    }

    const live = (connections ?? []).filter(connection => (SLOT_HOLDING_STATUSES as readonly string[]).includes(connection.status)).length
    const report = {
        dryRun,
        linkupAccounts: accounts.length,
        liveConnections: live,
        deleted: verdicts.map(verdict => `${verdict.accountId} (${verdict.reason})`),
        failed,
        estimatedMonthlyUsd: Math.round((accounts.length - (dryRun ? 0 : verdicts.length)) * LINKUP_ACCOUNT_MONTHLY_USD),
    }
    if (failed.length > 0) logger.error('paid apps reconciliation needs a look', report)
    else logger.log('paid apps reconciliation', report)
    return report
}

export const paidAppsReconcile = task({
    id: 'paid-apps-reconcile',
    queue: paidAppsQueue,
    maxDuration: 600,
    retry: { maxAttempts: 1 },
    run: async (payload: ReconcilePayload, { ctx }) => {
        if (ctx.environment.type !== 'PRODUCTION' && !payload.dryRun) {
            logger.error('paid apps reconciliation: refusing to delete outside production, pass dryRun')
            return null
        }
        return reconcile(payload)
    },
})

export const paidAppsReconcileSchedule = schedules.task({
    id: 'paid-apps-reconcile-daily',
    cron: '41 5 * * *',
    queue: paidAppsQueue,
    maxDuration: 600,
    retry: { maxAttempts: 1 },
    run: async (_payload, { ctx }) => {
        if (ctx.environment.type !== 'PRODUCTION') {
            logger.log('paid apps reconciliation: skipped, not production')
            return null
        }
        return reconcile({})
    },
})
