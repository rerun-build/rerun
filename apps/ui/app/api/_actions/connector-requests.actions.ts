'use server'

import type { Database } from '@/app/api/database.types'
import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { getServerSession } from '@/supabase/session/getServerSession'
import { failure, type ActionFailure } from '@/lib/i18n/action-error'

// A user searched the connector library, found nothing, and asked us to add the connector
// they need. We persist that ask in `connector_requests` for follow-up. Generic on purpose:
// the description is free text, the search term is not reinjected.
export type RequestConnectorResult = { ok: true } | ActionFailure

export async function requestConnectorAction(input: { description: string; agentId?: string }): Promise<RequestConnectorResult> {
    const description = input.description.trim()
    if (!description) return failure('describeAppNeeded')

    // Trust the session for the workspace, not the client.
    const workspaceId = await requireWorkspaceId()
    if (isManagedWorkspace((await getServerSession()).workspace)) return failure('managedWorkspace')

    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('connector_requests').insert<Database['public']['Tables']['connector_requests']['Insert']>({
        workspace_id: workspaceId,
        agent_id: input.agentId ?? null,
        description,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
}
