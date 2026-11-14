'use server'

import { rewindPayloadSchema, type RewindPayload } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

const MAX_WEEKS = 52

export type RewindWeekEntry = { id: string; weekStart: string; viewed: boolean }

export async function listRewindsAction(): Promise<RewindWeekEntry[]> {
    const { supabase, workspace, userId } = await requireWorkspaceContext()
    const { data: rewinds } = await selectMany(supabase, 'workspace_rewinds', ['id', 'week_start'] as const, { workspace_id: workspace.id }, { column: 'week_start', ascending: false }, MAX_WEEKS)
    if (!rewinds?.length) return []

    const { data: views } = await selectMany(supabase, 'workspace_rewind_views', ['rewind_id'] as const, { rewind_id: rewinds.map(rewind => rewind.id), user_id: userId })
    const viewed = new Set((views ?? []).map(view => view.rewind_id))
    return rewinds.map(rewind => ({ id: rewind.id, weekStart: rewind.week_start, viewed: viewed.has(rewind.id) }))
}

export async function readRewindAction(rewindId: string): Promise<RewindPayload | null> {
    const { supabase, workspace } = await requireWorkspaceContext()
    const { data } = await selectMaybeSingle(supabase, 'workspace_rewinds', ['payload'] as const, { id: rewindId, workspace_id: workspace.id })
    const parsed = rewindPayloadSchema.safeParse(data?.payload)
    return parsed.success ? parsed.data : null
}

export async function markRewindViewedAction(rewindId: string): Promise<void> {
    const { supabase, workspace, userId } = await requireWorkspaceContext()
    const { data: rewind } = await selectMaybeSingle(supabase, 'workspace_rewinds', ['id'] as const, { id: rewindId, workspace_id: workspace.id })
    if (!rewind) return
    await supabase
        .from('workspace_rewind_views')
        .upsert<Database['public']['Tables']['workspace_rewind_views']['Insert']>({ rewind_id: rewind.id, user_id: userId }, { onConflict: 'rewind_id,user_id', ignoreDuplicates: true })
}
