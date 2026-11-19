import { task } from '@trigger.dev/sdk/v3'
import { taskLogger as logger } from '@moldwright/cloud/tasks'

import type { Database, Json } from '@/app/api/database.types'
import { MAX_STORED_IDEAS, toStoredIdeas, type StoredAgentIdeas } from '@/lib/agent-ideas/stored'
import { suggestAgents } from '@/lib/agent-ideas/suggest'
import { createServiceRoleClient } from '@/supabase/serviceRole'

export type SuggestAgentIdeasPayload = { workspaceId: number }

export const suggestAgentIdeasTask = task({
    id: 'suggest-agent-ideas',
    maxDuration: 600,
    retry: { maxAttempts: 1 },
    run: (payload: SuggestAgentIdeasPayload) => suggestAgentIdeasRun(payload),
})

export async function suggestAgentIdeasRun({ workspaceId }: SuggestAgentIdeasPayload) {
    const supabase = createServiceRoleClient()

    async function write(row: StoredAgentIdeas) {
        const { error } = await supabase
            .from('workspace_onboarding')
            .upsert<Database['public']['Tables']['workspace_onboarding']['Insert']>({ workspace_id: workspaceId, agent_ideas: row as unknown as Json }, { onConflict: 'workspace_id' })
        if (error) logger.warn('agent ideas: not written', { workspaceId, error: error.message })
    }

    await write({ status: 'running', generatedAt: new Date().toISOString(), ideas: [] })

    const selection = await suggestAgents(supabase, workspaceId, event => {
        if (event.type === 'error') logger.warn('agent ideas: step failed', { workspaceId, step: event.step, error: event.error })
    })
    const ideas = selection ? toStoredIdeas(selection.eligible) : []
    await write({ status: selection ? 'done' : 'failed', generatedAt: new Date().toISOString(), ideas })

    logger.log('agent ideas: done', { workspaceId, stored: ideas.length, cap: MAX_STORED_IDEAS, failed: !selection })
    return { stored: ideas.length }
}
