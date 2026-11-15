import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectCount, selectMany } from '@/supabase/supabase-helpers'
import { loadFirstName } from '@/lib/auth/recipient'
import { loadTeam } from '@/lib/og/team-board'
import { deliverWhatsApp } from './send'
import { teamBoardUrl } from './team'
import { accessEndsHelpMessage, accessEndsRecapMessage, type WhatsAppMessage } from './templates'

const DAY_MS = 24 * 60 * 60_000

export const ACCESS_ENDING_LEAD_MS = DAY_MS
const RECAP_WINDOW_MS = 30 * DAY_MS

const RECAP_MIN_TASKS = 2

const BILLING_PATH = '?billing=1'
const HOME_PATH = ''

export type AccessEndingReport = { considered: number; sent: number[]; skipped: string[] }

type EndingWorkspace = { id: number; subscription_cancel_at: string | null }

async function messageFor(supabase: SupabaseClient<Database>, workspaceId: number, ownerId: string, now: Date): Promise<WhatsAppMessage | null> {
    const team = await loadTeam(supabase, workspaceId)
    if (team.length === 0) return null

    const { data: taskCount } = await selectCount(supabase, 'notifications', { workspace_id: workspaceId, kind: 'done', created_at: { gte: new Date(now.getTime() - RECAP_WINDOW_MS).toISOString() } })
    if ((taskCount ?? 0) >= RECAP_MIN_TASKS) {
        const firstName = await loadFirstName(supabase, ownerId)
        return accessEndsRecapMessage({ imageUrl: teamBoardUrl(team, 'working'), firstName, taskCount: taskCount ?? 0, path: BILLING_PATH })
    }

    return accessEndsHelpMessage({ imageUrl: teamBoardUrl(team, 'offline'), path: HOME_PATH })
}

export async function sweepAccessEnding(supabase: SupabaseClient<Database>, now: Date, only?: number[]): Promise<AccessEndingReport> {
    const { data } = await selectMany(
        supabase,
        'workspaces',
        ['id', 'subscription_cancel_at'] as const,
        { subscription_cancel_at: { gte: now.toISOString(), lte: new Date(now.getTime() + ACCESS_ENDING_LEAD_MS).toISOString() }, is_sandbox: false, ...(only ? { id: only } : {}) },
        { column: 'subscription_cancel_at', ascending: true },
    )
    const workspaces: EndingWorkspace[] = data ?? []
    const report: AccessEndingReport = { considered: workspaces.length, sent: [], skipped: [] }

    for (const workspace of workspaces) {
        try {
            const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspace.id }, { column: 'created_at', ascending: true }, 1)
            const owner = members?.[0]
            const message = owner ? await messageFor(supabase, workspace.id, owner.user_id, now) : null
            if (!owner || !message) {
                report.skipped.push(`${workspace.id}: ${owner ? 'no_coworker' : 'no_owner'}`)
                continue
            }

            const result = await deliverWhatsApp(supabase, {
                userId: owner.user_id,
                workspaceId: workspace.id,
                message,
                language: 'en',
                dedupeKey: `access_ends:${workspace.id}:${workspace.subscription_cancel_at}`,
            })
            if (result.sent) report.sent.push(workspace.id)
            else if (result.reason !== 'duplicate') report.skipped.push(`${workspace.id}: ${result.reason}`)
        } catch (err) {
            report.skipped.push(`${workspace.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    return report
}
