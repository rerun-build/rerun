'use server'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import type { StoredAgentIdeas } from '@/lib/agent-ideas/stored'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export async function loadAgentIdeasAction(): Promise<StoredAgentIdeas | null> {
    const ctx = await requireWorkspaceContext()
    const { data } = await selectMaybeSingle(ctx.supabase, 'workspace_onboarding', ['agent_ideas'] as const, { workspace_id: ctx.workspace.id })
    return (data?.agent_ideas ?? null) as StoredAgentIdeas | null
}
