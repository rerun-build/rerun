import 'server-only'

import { createServiceRoleClient } from '@/supabase/serviceRole'

// The Chief of Staff's row of `agents`, written the first time the workspace needs it: an anonymous
// visitor's workspace never gets one it would not use.
export async function foremanAgentId(workspaceId: number): Promise<string> {
    const { data, error } = await createServiceRoleClient().rpc('ensure_foreman_agent', { p_workspace_id: workspaceId })
    if (error || !data) throw new Error(`Failed to resolve the Chief of Staff of workspace ${workspaceId}: ${error?.message ?? 'no row'}`)
    return data
}
