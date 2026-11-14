import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { selectMany } from '@/supabase/supabase-helpers'
import { notifyWorkspace } from './notify'
import { appDefinition } from './registry'
import { isAppSlug, type AppSlug } from './types'

type Client = SupabaseClient<Database>
type WorkspaceAppUpdate = Database['public']['Tables']['workspace_apps']['Update']

export const TRIAL_REMINDER_LEAD_MS = 2 * 86_400_000

export type TrialStep = 'remind' | 'convert' | null

export function trialStep(app: { trial_ends_at: string | null; trial_settled_at: string | null; trial_reminder_sent_at: string | null }, now: Date): TrialStep {
    if (!app.trial_ends_at || app.trial_settled_at) return null
    const endsAt = new Date(app.trial_ends_at).getTime()
    if (now.getTime() >= endsAt) return 'convert'
    if (!app.trial_reminder_sent_at && now.getTime() >= endsAt - TRIAL_REMINDER_LEAD_MS) return 'remind'
    return null
}

function dateLabel(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

async function settle(supabase: Client, workspaceId: number, slug: AppSlug, update: WorkspaceAppUpdate): Promise<void> {
    const { error } = await supabase
        .from('workspace_apps')
        .update<WorkspaceAppUpdate>({ ...update, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('app_slug', slug)
    if (error) throw new Error(error.message)
}

export async function sweepSubscriberTrials(supabase: Client, now: Date): Promise<{ reminded: number; free: number; failed: string[] }> {
    const { data: apps } = await selectMany(supabase, 'workspace_apps', ['workspace_id', 'app_slug', 'trial_ends_at', 'trial_settled_at', 'trial_reminder_sent_at', 'status'] as const, { trial_ends_at: { notNull: true }, trial_settled_at: { isNull: true } })
    const report = { reminded: 0, free: 0, failed: [] as string[] }

    for (const row of apps ?? []) {
        if (!isAppSlug(row.app_slug)) continue
        const step = trialStep(row, now)
        try {
            if (step === 'remind' && row.status === 'active') {
                const app = appDefinition(row.app_slug)
                await notifyWorkspace(supabase, row.workspace_id, {
                    appName: app.name,
                    message: `Your free ${app.providerLabel} slot ends on ${dateLabel(row.trial_ends_at as string)}. Disconnect the account from Settings → Apps before then if you do not want to keep it.`,
                    copy: { key: 'trialEndsSoon', values: { provider: app.providerLabel, endsAt: row.trial_ends_at as string } },
                    email: true,
                })
                await settle(supabase, row.workspace_id, row.app_slug, { trial_reminder_sent_at: now.toISOString() })
                report.reminded++
            }
            if (step === 'convert') {
                await settle(supabase, row.workspace_id, row.app_slug, { trial_settled_at: now.toISOString() })
                report.free++
            }
        } catch (err) {
            report.failed.push(`${row.workspace_id}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
    return report
}
