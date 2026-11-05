'use server'

import { assertAgentInWorkspace, requireWorkspaceContext, requireWorkspaceId } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { EMAIL_DELIVERY } from '@/cloud/email'
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
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { ActionResult } from './space.actions'

function failure(err: unknown, fallback: string): { ok: false; error: string } {
    return { ok: false, error: err instanceof Error ? err.message : fallback }
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
        return await listWorkspacePublished(await requireWorkspaceId())
    } catch {
        return []
    }
}

export async function getPublishedAction(slug: string): Promise<PublishedFile | null> {
    try {
        return await getPublishedInWorkspace(await requireWorkspaceId(), slug)
    } catch {
        return null
    }
}

// Publish a workspace file by hand from the Files tab. It starts with the access the workspace
// gives a new link, and the share dialog opens right after to change it.
export async function publishFileAction(agentId: string, path: string): Promise<{ success: boolean; url?: string; slug?: string; error?: string }> {
    try {
        await assertAgentInWorkspace(agentId)
        const result = await publishWithThumbnail(agentId, path)
        return { success: true, url: result.url, slug: result.slug }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to publish' }
    }
}

// Revoke a published file by its slug: deletes the copy and makes its URL stop working.
export async function unpublishFileAction(agentId: string, slug: string): Promise<{ success: boolean; error?: string }> {
    try {
        await assertAgentInWorkspace(agentId)
        await unpublishFile(agentId, { slug })
        return { success: true }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to unpublish' }
    }
}

export async function unpublishLinkAction(slug: string): Promise<ActionResult> {
    try {
        await unpublishInWorkspace(await requireWorkspaceId(), slug)
        return { ok: true }
    } catch (err) {
        return failure(err, 'Failed to unpublish')
    }
}

export async function updatePublishedAccessAction(slug: string, change: AccessChange): Promise<ActionResult<{ file: PublishedFile }>> {
    try {
        if (!isPublishedAccess(change.access)) return { ok: false, error: 'Unknown access' }
        if (change.access === 'invited' && !EMAIL_DELIVERY) return { ok: false, error: 'This server sends no email, so invites cannot get their code.' }
        const file = await updatePublishedAccess(await requireWorkspaceId(), slug, change)
        return { ok: true, file }
    } catch (err) {
        return failure(err, 'Failed to update the link')
    }
}

export async function dismissAccessRequestAction(slug: string): Promise<ActionResult> {
    try {
        await dismissAccessRequest(await requireWorkspaceId(), slug)
        return { ok: true }
    } catch (err) {
        return failure(err, 'Failed to update the link')
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

// Any member may change it: every member holds the same rights. "Nothing goes public" closes the
// links already public on the way.
export async function updatePublishPolicyAction(policy: PublishPolicy): Promise<ActionResult<{ closed: number }>> {
    try {
        if (!isPublishPolicy(policy)) return { ok: false, error: 'Unknown policy' }
        const { workspace, supabase } = await requireWorkspaceContext()
        const { error } = await supabase
            .from('workspaces')
            .update<Database['public']['Tables']['workspaces']['Update']>({ publish_policy: policy })
            .eq('id', workspace.id)
        if (error) return { ok: false, error: error.message }
        const closed = policy === 'never' ? await closePublicLinks(workspace.id) : 0
        return { ok: true, closed }
    } catch (err) {
        return failure(err, 'Failed to save the policy')
    }
}
