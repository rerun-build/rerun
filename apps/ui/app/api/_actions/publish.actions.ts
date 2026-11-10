'use server'

import { assertAgentInWorkspace, isAdminActor, requireLightSessionActor, visibleAgentIds } from '@/app/api/_auth/access'
import { requireAdminContext, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { EMAIL_DELIVERY } from '@rerun/cloud/email'
import { isPublishPolicy, isPublishedAccess, shownPolicy, type PublishPolicy } from '@/lib/published/access'
import {
    closePublicLinks,
    countPublicLinks,
    dismissAccessRequest,
    getPublishedInWorkspace,
    listPublished,
    listWorkspacePublished,
    unpublishFile,
    unpublishInWorkspace,
    updatePublishedAccess,
    type AccessChange,
} from '@/lib/services/publish'
import { publishWithThumbnail } from '@/lib/services/publish-thumbnail'
import type { PublishedFile } from '@/lib/services/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { failure, failureOf, refusalOf, type ActionRefusal } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'

// A link is the coworker's that published it: reaching the link by its slug takes reaching that
// coworker's Box, the way the coworker's Published tab does. An admin reaches them all.
async function reachablePublishedWorkspaceId(slug: string): Promise<number> {
    const actor = await requireLightSessionActor()
    if (isAdminActor(actor)) return actor.workspaceId
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'published_files', ['agent_id'] as const, { workspace_id: actor.workspaceId, slug })
    if (data) await assertAgentInWorkspace(data.agent_id, 'use', actor)
    return actor.workspaceId
}

// Files an agent has published (see lib/services/publish.ts). Read by the Files tab
// (components/AgentPanelFiles.tsx) to mark which workspace files are published, and by the
// coworker's Published tab.
export async function listPublishedAction(agentId: string): Promise<PublishedFile[]> {
    try {
        await assertAgentInWorkspace(agentId)
        const { files } = await listPublished(agentId)
        return files
    } catch {
        return []
    }
}

export async function listWorkspacePublishedAction(): Promise<PublishedFile[]> {
    try {
        const actor = await requireLightSessionActor()
        return await listWorkspacePublished(actor.workspaceId, await visibleAgentIds(actor))
    } catch {
        return []
    }
}

export async function getPublishedAction(slug: string): Promise<PublishedFile | null> {
    try {
        return await getPublishedInWorkspace(await reachablePublishedWorkspaceId(slug), slug)
    } catch {
        return null
    }
}

// Publish a workspace file by hand from the Files tab. It starts with the access the workspace
// gives a new link, and the share dialog opens right after to change it.
export async function publishFileAction(agentId: string, path: string): Promise<{ success: boolean; url?: string; slug?: string } & Partial<ActionRefusal>> {
    try {
        await assertAgentInWorkspace(agentId)
        const result = await publishWithThumbnail(agentId, path)
        return { success: true, url: result.url, slug: result.slug }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'publishFailed') }
    }
}

// Revoke a published file by its slug: deletes the copy and makes its URL stop working.
export async function unpublishFileAction(agentId: string, slug: string): Promise<{ success: boolean } & Partial<ActionRefusal>> {
    try {
        await assertAgentInWorkspace(agentId)
        await unpublishFile(agentId, { slug })
        return { success: true }
    } catch (err) {
        return { success: false, ...refusalOf(err, 'unpublishFailed') }
    }
}

export async function unpublishLinkAction(slug: string): Promise<ActionResult> {
    try {
        await unpublishInWorkspace(await reachablePublishedWorkspaceId(slug), slug)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'unpublishFailed')
    }
}

export async function updatePublishedAccessAction(slug: string, change: AccessChange): Promise<ActionResult<{ file: PublishedFile }>> {
    try {
        if (!isPublishedAccess(change.access)) return failure('unknownAccess')
        if (change.access === 'invited' && !EMAIL_DELIVERY) return failure('noEmailForInvites')
        const file = await updatePublishedAccess(await reachablePublishedWorkspaceId(slug), slug, change)
        return { ok: true, file }
    } catch (err) {
        return failureOf(err, 'updateLinkFailed')
    }
}

export async function dismissAccessRequestAction(slug: string): Promise<ActionResult> {
    try {
        await dismissAccessRequest(await reachablePublishedWorkspaceId(slug), slug)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'updateLinkFailed')
    }
}

export type PublishSettings = { policy: PublishPolicy; publicLinks: number; invitesAvailable: boolean }

export async function getPublishSettingsAction(): Promise<PublishSettings | null> {
    try {
        const { workspace, supabase } = await requireWorkspaceContext()
        const [{ data }, publicLinks] = await Promise.all([
            selectMaybeSingle(supabase, 'workspaces', ['publish_policy'] as const, { id: workspace.id }),
            countPublicLinks(workspace.id),
        ])
        return { policy: shownPolicy(data?.publish_policy), publicLinks, invitesAvailable: EMAIL_DELIVERY }
    } catch {
        return null
    }
}

// An admin's to change. "Nothing goes public" closes the links already public on the way.
export async function updatePublishPolicyAction(policy: PublishPolicy): Promise<ActionResult<{ closed: number }>> {
    try {
        if (!isPublishPolicy(policy)) return failure('unknownPolicy')
        const { workspace, supabase } = await requireAdminContext('adminOnlyPublishing')
        const { error } = await supabase
            .from('workspaces')
            .update<Database['public']['Tables']['workspaces']['Update']>({ publish_policy: policy })
            .eq('id', workspace.id)
        if (error) return { ok: false, error: error.message }
        const closed = policy === 'never' ? await closePublicLinks(workspace.id) : 0
        return { ok: true, closed }
    } catch (err) {
        return failureOf(err, 'savePolicyFailed')
    }
}
