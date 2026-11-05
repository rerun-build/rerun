import type { Database } from '@/app/api/database.types'
import { workspaceFounderUserId } from '@/app/api/_auth/ownership'
import { isBlobUrl } from '@/lib/blobs/catalog'
import { readFirstName } from '@/lib/naming/first-name'
import { DEFAULT_WORKSPACE_NAME, workspaceNameFrom } from '@/lib/naming/workspace-name'
import { boxNameFrom, companyNameFromAnswers, industryFromAnswers } from '@/lib/onboarding/box-name'
import { faviconUrl, siteDomain } from '@/lib/onboarding/site-favicon'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle, selectSingle } from '@/supabase/supabase-helpers'

type Profile = { companyName: string | null; companyUrl: string | null; industry: string | null; firstName: string | null }

// What the workspace's onboarding knows about the company, read in service role rather than taken
// from the client: a caller that acts in the same tick as the foreman's `save_profile` would still
// hold the answers from before it, which is how a Box ended up unnamed for someone whose company we
// had just read off their site. The first name is the caller's own.
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

// The name a Box is created with. A name typed by the user wins; everything else is the ladder in
// `boxNameFrom`, which always yields something. This is the only place a Box name is decided, so an
// unnamed Box is not a case the rest of the app has to handle.
export async function resolveBoxName(params: { workspaceId: number; taken: string[]; proposed?: string | null }): Promise<string> {
    const proposed = params.proposed?.trim()
    if (proposed) return proposed

    const profile = await onboardingProfile(params.workspaceId)
    return boxNameFrom({ ...profile, taken: params.taken })
}

// Google's favicon service answers a generic globe for a domain it has never seen, and answers it
// with a 404 that only shows up once the redirect is followed. A browser paints that body regardless,
// so the status is checked here: `icon_url` is rendered as a bare <img src> down to the anonymous
// public site, and a grey globe there is strictly worse than the blob it replaced.
async function faviconIfServed(domain: string): Promise<string | null> {
    const url = faviconUrl(domain)
    try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) })
        return res.ok ? url : null
    } catch {
        return null
    }
}

// Names the workspace once, from whatever the onboarding learned. Silent on every failure: it is
// called from the Box claim, which hands a pool engine back on any throw, and no name is worth an
// engine.
export async function ensureWorkspaceNamed(params: { workspaceId: number; userId: string }): Promise<void> {
    try {
        const supabase = createServiceRoleClient()
        const { data: workspace } = await selectSingle(supabase, 'workspaces', ['id', 'name', 'icon_url', 'is_sandbox'] as const, { id: params.workspaceId })
        if (!workspace || workspace.is_sandbox) return
        // A name already on the row was either chosen in the settings dialog or written by an earlier
        // pass. Either way it is someone's answer, and nothing here overwrites it.
        if (workspace.name && workspace.name !== DEFAULT_WORKSPACE_NAME) return

        // The name falls back on the caller's first name when the onboarding found no company: an
        // invited member claiming a Box must not get the team's workspace named after them.
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
