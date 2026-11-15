import 'server-only'

import type { Database, Json } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type BuildInsert = Database['public']['Tables']['foreman_builds']['Insert']
type BuildUpdate = Database['public']['Tables']['foreman_builds']['Update']

const STALE_AFTER_MS = 10 * 60_000

const UNIQUE_VIOLATION = '23505'

export type BuildClaim = { previous: Json | null; claimedAt: string }

export async function claimBuild(workspaceId: number): Promise<BuildClaim | null> {
    const supabase = createServiceRoleClient()
    const now = Date.now()
    const claimedAt = new Date(now).toISOString()
    const { error } = await supabase.from('foreman_builds').insert<BuildInsert>({ workspace_id: workspaceId, started_at: claimedAt })
    if (!error) return { previous: null, claimedAt }
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`Could not claim the team build: ${error.message}`)

    const staleBefore = new Date(now - STALE_AFTER_MS).toISOString()
    const { data, error: takeError } = await supabase
        .from('foreman_builds')
        .update<BuildUpdate>({ started_at: claimedAt, finished_at: null })
        .eq('workspace_id', workspaceId)
        .or(`finished_at.not.is.null,started_at.lt.${staleBefore}`)
        .select('result')
    if (takeError) throw new Error(`Could not claim the team build: ${takeError.message}`)
    return data?.length ? { previous: data[0].result, claimedAt } : null
}

export async function releaseBuild(workspaceId: number, claimedAt: string, result: Json | null): Promise<void> {
    const supabase = createServiceRoleClient()
    const { error } = await supabase
        .from('foreman_builds')
        .update<BuildUpdate>({ finished_at: new Date().toISOString(), result })
        .eq('workspace_id', workspaceId)
        .eq('started_at', claimedAt)
    if (error) throw new Error(`Could not release the team build: ${error.message}`)
}

export async function finishedBuild(workspaceId: number): Promise<{ result: Json | null } | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'foreman_builds', ['finished_at', 'result'] as const, { workspace_id: workspaceId })
    return data?.finished_at ? { result: data.result } : null
}
