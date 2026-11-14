import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/app/api/database.types'
import { globalIdempotencyKey, triggerTask } from '@rerun/cloud/tasks'
import type { CompanyFindingsRow } from '@/lib/company/explore/findings'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { exploreCompanyTask } from '@/trigger/explore-company'
import type { seedCompanyBrain } from '@/trigger/seed-company-brain'
import type { suggestAgentIdeasTask } from '@/trigger/suggest-agent-ideas'

export async function requestCompanyBrainSeed(workspaceId: number, idempotencyKey: string, exploreKey?: string): Promise<boolean> {
    try {
        await triggerTask<typeof seedCompanyBrain>('seed-company-brain', { workspaceId, exploreKey }, { idempotencyKey })
        return true
    } catch (err) {
        console.error('Failed to request a company brain seed', workspaceId, err)
        return false
    }
}

export async function requestAgentIdeas(workspaceId: number, seedKey: string): Promise<void> {
    try {
        await triggerTask<typeof suggestAgentIdeasTask>('suggest-agent-ideas', { workspaceId }, { idempotencyKey: await globalIdempotencyKey(`agent-ideas-${workspaceId}-${seedKey}`) })
    } catch (err) {
        console.error('Failed to request agent ideas', workspaceId, err)
    }
}

export function companyExploreKey(workspaceId: number, url: string): string {
    return `company-explore-${workspaceId}-${url}`
}

export function companyExploreIdempotencyKey(key: string) {
    return globalIdempotencyKey(key)
}

export async function requestCompanyExplore(supabase: SupabaseClient<Database>, workspaceId: number, url: string): Promise<void> {
    const { data } = await selectMaybeSingle(supabase, 'workspace_onboarding', ['company_findings'] as const, { workspace_id: workspaceId })
    const current = data?.company_findings as CompanyFindingsRow | null | undefined
    if (current?.url === url) return

    const queued: CompanyFindingsRow = { url, status: 'running', pending: [], findings: [] }
    const { error } = await supabase
        .from('workspace_onboarding')
        .update<Database['public']['Tables']['workspace_onboarding']['Update']>({ company_findings: queued as unknown as Json })
        .eq('workspace_id', workspaceId)
    if (error) throw new Error(error.message)
    await triggerTask<typeof exploreCompanyTask>('explore-company', { workspaceId, url }, { idempotencyKey: await companyExploreIdempotencyKey(companyExploreKey(workspaceId, url)) })
}
