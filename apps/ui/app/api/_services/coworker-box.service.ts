import 'server-only'

import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { setBrainAgentBoxes } from '@/lib/engine/client'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'

// The Brain files what a coworker adds under its Box, but the Boxes live here: the engine gets the
// whole map in one call. Sent when a coworker is made or moves and each time the Brain opens, which
// also brings back an engine that missed a move. A failure only leaves the map as it was.
export async function syncCoworkerBoxes(workspaceId: number): Promise<void> {
    try {
        const supabase = createServiceRoleClient()
        const { data: agents, error } = await selectMany(supabase, 'agents', ['engine_agent_id', 'space_id'] as const, { workspace_id: workspaceId })
        if (error) throw error
        const boxes = Object.fromEntries((agents ?? []).filter(agent => agent.engine_agent_id).map(agent => [agent.engine_agent_id as string, agent.space_id]))
        await setBrainAgentBoxes(await getWorkspaceConnection(workspaceId), boxes)
    } catch (err) {
        console.error(`[coworker-box] the Brain of workspace ${workspaceId} kept its previous Boxes`, err)
    }
}
