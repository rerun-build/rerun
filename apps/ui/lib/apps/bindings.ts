import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/app/api/database.types'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { deleteTrigger } from '@/lib/engine/client'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { AppSlug } from './types'

type Client = SupabaseClient<Database>
type BindingUpdate = Database['public']['Tables']['app_connection_agents']['Update']

export async function dropWakeTrigger(supabase: Client, workspaceId: number, agentId: string, slug: AppSlug): Promise<void> {
    const { data: binding } = await selectMaybeSingle(supabase, 'app_connection_agents', ['trigger_slug'] as const, { agent_id: agentId, app_slug: slug })
    if (!binding?.trigger_slug) return
    const { data: agent } = await selectMaybeSingle(supabase, 'agents', ['engine_agent_id'] as const, { id: agentId })
    if (agent?.engine_agent_id) {
        const conn = await getWorkspaceConnection(workspaceId).catch(() => null)
        if (conn) await deleteTrigger(conn, agent.engine_agent_id, binding.trigger_slug).catch(err => console.warn(`[apps:${slug}] could not delete the wake trigger`, err))
    }
    const { error } = await supabase
        .from('app_connection_agents')
        .update<BindingUpdate>({ trigger_slug: null, trigger_token: null, wake_on_events: [], updated_at: new Date().toISOString() })
        .eq('agent_id', agentId)
        .eq('app_slug', slug)
    if (error) throw new Error(error.message)
}

export async function unbindAgent(supabase: Client, workspaceId: number, agentId: string, slug: AppSlug): Promise<void> {
    await dropWakeTrigger(supabase, workspaceId, agentId, slug)
    const { error } = await supabase.from('app_connection_agents').delete().eq('agent_id', agentId).eq('app_slug', slug)
    if (error) throw new Error(error.message)
}
