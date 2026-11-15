import type { Database } from '@/app/api/database.types'
import { workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { isBlobUrl } from '@/lib/blobs/catalog'
import { readFirstName } from '@/lib/naming/first-name'
import { DEFAULT_WORKSPACE_NAME, workspaceNameFrom } from '@/lib/naming/workspace-name'
import { boxNameFrom, companyNameFromAnswers, industryFromAnswers } from '@/lib/onboarding/box-name'
import { faviconUrl, siteDomain } from '@/lib/onboarding/site-favicon'
import { findSiteIcon } from '@/lib/onboarding/site-icon.server'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'

type Profile = { companyName: string | null; companyUrl: string | null; industry: string | null; firstName: string | null }

async function onboardingProfile(workspaceId: number): Promise<Profile> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMaybeSingle(supabase, 'workspace_onboarding', ['answers'] as const, { workspace_id: workspaceId })
    const answers = data?.answers ?? null
    const { session } = await getServerSession()

    return {
        companyName: companyNameFromAnswers(answers),
        companyUrl: (answers as { company_url?: string } | null)?.company_url ?? null,
        industry: industryFromAnswers(answers),
        firstName: readFirstName(session?.user_metadata) || null,
    }
}

export async function resolveBoxName(params: { workspaceId: number; taken: string[]; proposed?: string | null }): Promise<string> {
    const proposed = params.proposed?.trim()
    if (proposed) return proposed

    const profile = await onboardingProfile(params.workspaceId)
    return boxNameFrom({ ...profile, taken: params.taken })
}

async function faviconIfServed(domain: string): Promise<string | null> {
    return (await findSiteIcon(domain)) ? faviconUrl(domain) : null
}

export async function ensureWorkspaceNamed(params: { workspaceId: number; userId: string }): Promise<void> {
    try {
        const supabase = createServiceRoleClient()
        const { data: workspace } = await selectSingle(supabase, 'workspaces', ['id', 'name', 'icon_url', 'is_sandbox'] as const, { id: params.workspaceId })
        if (!workspace || workspace.is_sandbox) return
        if (workspace.name && workspace.name !== DEFAULT_WORKSPACE_NAME) return

        if ((await workspaceFounderUserId(params.workspaceId)) !== params.userId) return

        const profile = await onboardingProfile(params.workspaceId)
        const name = workspaceNameFrom(profile)
        if (name === DEFAULT_WORKSPACE_NAME) return

        const domain = profile.companyName && profile.companyUrl ? siteDomain(profile.companyUrl) : null
        const icon = domain && (!workspace.icon_url || isBlobUrl(workspace.icon_url)) ? await faviconIfServed(domain) : null

        const { error } = await supabase
            .from('workspaces')
            .update<Database['public']['Tables']['workspaces']['Update']>({ name, ...(icon ? { icon_url: icon } : {}) })
            .eq('id', params.workspaceId)
        if (error) console.error('Error naming workspace', error)
    } catch (err) {
        console.error('Error naming workspace', err)
    }
}
