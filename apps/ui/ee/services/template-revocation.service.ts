import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import { pauseAgentSchedules, resumeAgentSchedules } from '@/app/api/_services/agent.service'

type AgentUpdate = Database['public']['Tables']['agents']['Update']
type PurchaseUpdate = Database['public']['Tables']['template_purchases']['Update']

export function revocationReason(templateId: string): string {
    return `template_revoked:${templateId}`
}

export async function revokeTemplateAccess(workspaceId: number, templateId: string, status: 'canceled' | 'refunded' = 'canceled'): Promise<void> {
    const supabase = createServiceRoleClient()
    const now = new Date().toISOString()

    await supabase
        .from('template_purchases')
        .update<PurchaseUpdate>({ status, revoked_at: now, updated_at: now })
        .eq('workspace_id', workspaceId)
        .eq('template_id', templateId)

    await supabase
        .from('agents')
        .update<AgentUpdate>({ disabled_at: now, disabled_reason: revocationReason(templateId) })
        .eq('workspace_id', workspaceId)
        .eq('template_id', templateId)
        .is('disabled_at', null)
}

export async function pauseTemplateAgentSchedules(workspaceId: number, templateId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: agents } = await selectMany(supabase, 'agents', ['id'] as const, {
        workspace_id: workspaceId,
        template_id: templateId,
        disabled_reason: revocationReason(templateId),
    })

    for (const agent of agents ?? []) {
        await pauseAgentSchedules(agent.id)
    }
}

export async function reenableAgentsForTemplate(workspaceId: number, templateId: string): Promise<void> {
    const supabase = createServiceRoleClient()
    const reason = revocationReason(templateId)

    const { data: agents } = await selectMany(supabase, 'agents', ['id'] as const, { workspace_id: workspaceId, template_id: templateId, disabled_reason: reason })
    if (!agents?.length) return

    await supabase
        .from('agents')
        .update<AgentUpdate>({ disabled_at: null, disabled_reason: null })
        .eq('workspace_id', workspaceId)
        .eq('template_id', templateId)
        .eq('disabled_reason', reason)

    for (const agent of agents) {
        try {
            await resumeAgentSchedules(agent.id)
        } catch (err) {
            console.error('[templates] failed to resume schedules after a re-purchase', agent.id, err)
        }
    }
}
