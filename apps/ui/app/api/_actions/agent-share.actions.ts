'use server'

import { agentShareIncludeSchema, type AgentSharePreview } from '@rerun/contracts'
import { z } from 'zod'
import { getAdminEmail } from '@/lib/auth/admin'
import { actorFromContext, assertAgentInWorkspace, assertSpaceAccess, keepVisible } from '@/app/api/_auth/access'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { assertCanManageShare, shareManageableAgentIds } from '@/lib/agents/share-access'
import { createAgentShare, planAgentShare, type AgentSharePlan } from '@/lib/agents/share-create'
import { installAgentShare, type AgentShareInstallOutcome } from '@/lib/agents/share-install'
import { listWorkspaceShares, readAgentShare, revokeAgentShare, type WorkspaceShare } from '@/lib/agents/share-read'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { AppError, failureOf, type ActionFailure } from '@/lib/i18n/action-error'

type ActionResult<T = unknown> = ({ ok: true } & T) | ActionFailure

export async function planAgentShareAction(agentId: string): Promise<ActionResult<{ plan: AgentSharePlan }>> {
    try {
        const id = z.string().uuid().parse(agentId)
        const { workspace_id } = await assertAgentInWorkspace(id, 'manage')
        return { ok: true, plan: await planAgentShare(createServiceRoleClient(), id, workspace_id) }
    } catch (err) {
        return failureOf(err, 'inspectCoworkerFailed')
    }
}

const createInputSchema = z.object({ agentId: z.string().uuid(), include: agentShareIncludeSchema })

export async function createAgentShareAction(input: unknown): Promise<ActionResult<{ url: string; warnings: string[]; reused: boolean }>> {
    try {
        const { agentId, include } = createInputSchema.parse(input)
        const ctx = await requireWorkspaceContext()
        await assertAgentInWorkspace(agentId, 'manage', actorFromContext(ctx))
        const { url, warnings, reused } = await createAgentShare(ctx.supabase, { agentRowId: agentId, workspaceId: ctx.workspace.id, userId: ctx.userId, include })
        return { ok: true, url, warnings, reused }
    } catch (err) {
        return failureOf(err, 'createShareLinkFailed')
    }
}

export async function listAgentSharesAction(): Promise<ActionResult<{ shares: WorkspaceShare[] }>> {
    try {
        const ctx = await requireWorkspaceContext()
        const [shares, manageable] = await Promise.all([listWorkspaceShares(ctx.supabase, ctx.workspace.id), shareManageableAgentIds(actorFromContext(ctx))])
        return { ok: true, shares: keepVisible(shares, manageable, share => share.sourceAgentId) }
    } catch (err) {
        return failureOf(err, 'readShareLinksFailed')
    }
}

export async function revokeAgentShareAction(shareId: string): Promise<ActionResult<object>> {
    try {
        const id = z.string().uuid().parse(shareId)
        const ctx = await requireWorkspaceContext()
        await assertCanManageShare(ctx.supabase, id, actorFromContext(ctx))
        await revokeAgentShare(ctx.supabase, id, ctx.workspace.id)
        return { ok: true }
    } catch (err) {
        return failureOf(err, 'revokeLinkFailed')
    }
}

export async function getSharedAgentAction(token: string): Promise<AgentSharePreview | null> {
    const parsed = z.string().trim().max(64).safeParse(token)
    if (!parsed.success) return null
    return readAgentShare(createServiceRoleClient(), parsed.data)
}

const installInputSchema = z.object({
    token: z.string().min(1).max(64),
    spaceId: z.string().uuid(),
    position: z.object({ col: z.number().int(), row: z.number().int() }).optional(),
})

export type InstallSharedAgentResult = ({ ok: true } & AgentShareInstallOutcome) | ActionFailure

export async function installSharedAgentAction(input: unknown): Promise<InstallSharedAgentResult> {
    try {
        const { token, spaceId, position } = installInputSchema.parse(input)
        const { actor } = await assertSpaceAccess(spaceId, 'manage')
        const workspace_id = actor.workspaceId
        const supabase = createServiceRoleClient()

        if ((await getAdminEmail()) === null) {
            const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['subscription_status'] as const, { id: workspace_id })
            const status = workspace?.subscription_status
            if (status !== 'active' && status !== 'trialing') throw new AppError('noActivePlan')
        }

        return { ok: true, ...(await installAgentShare(supabase, token, { workspaceId: workspace_id, spaceId, actor, position })) }
    } catch (err) {
        return failureOf(err, 'addSharedCoworkerFailed')
    }
}
