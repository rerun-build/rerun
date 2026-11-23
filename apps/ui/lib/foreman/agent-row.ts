import type { SupabaseClient } from '@supabase/supabase-js'
import { FOREMAN_AGENT_ID, FOREMAN_DISPLAY_NAME } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

const UNIQUE_VIOLATION = '23505'

// The Chief of Staff's row of a workspace, written when the workspace is born. A workspace born
// another way (a Box split into one) gets it the first time it is asked for. Two callers racing meet
// on `agents_foreman_per_workspace_idx`: the second reads the first's row.
export async function ensureForemanAgentRow(supabase: SupabaseClient<Database>, workspaceId: number): Promise<string> {
    const existing = await selectMaybeSingle(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, kind: 'foreman' })
    if (existing.error) throw new Error(`Failed to read the Chief of Staff of workspace ${workspaceId}: ${existing.error.message}`)
    if (existing.data) return existing.data.id
    const { data, error } = await supabase
        .from('agents')
        .insert<Database['public']['Tables']['agents']['Insert']>({ workspace_id: workspaceId, kind: 'foreman', space_id: null, name: FOREMAN_DISPLAY_NAME, engine_agent_id: FOREMAN_AGENT_ID })
        .select('id')
        .single()
    if (data) return data.id
    if (error?.code !== UNIQUE_VIOLATION) throw new Error(`Failed to write the Chief of Staff of workspace ${workspaceId}: ${error?.message}`)
    const raced = await selectMaybeSingle(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, kind: 'foreman' })
    if (!raced.data) throw new Error(`The Chief of Staff of workspace ${workspaceId} could not be read back`)
    return raced.data.id
}
