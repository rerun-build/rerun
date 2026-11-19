import 'server-only'

import type { Database } from '@/app/api/database.types'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { patchAgent } from '@/lib/engine/client'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { DEFAULT_LOCALE, isStableLocale } from '@moldwright/i18n'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function coworkerLanguageFor(supabase: SupabaseClient<Database>, workspaceId: number): Promise<string | null> {
    const { data } = await selectMaybeSingle(supabase, 'workspaces', ['locale'] as const, { id: workspaceId })
    return isStableLocale(data?.locale) && data.locale !== DEFAULT_LOCALE ? data.locale : null
}

export async function applyCoworkerLanguage(supabase: SupabaseClient<Database>, workspaceId: number, language: string): Promise<void> {
    const { data: agents } = await selectMany(supabase, 'agents', ['engine_agent_id'] as const, { workspace_id: workspaceId })
    const ids = (agents ?? []).map(agent => agent.engine_agent_id).filter((id): id is string => Boolean(id))
    if (!ids.length) return
    const conn = await getWorkspaceConnection(workspaceId)
    const results = await Promise.allSettled(ids.map(id => patchAgent(conn, id, { language })))
    const failed = results.filter(result => result.status === 'rejected').length
    if (failed) console.error(`[coworker-language] ${failed} of ${ids.length} coworkers kept their language in workspace ${workspaceId}`)
}
