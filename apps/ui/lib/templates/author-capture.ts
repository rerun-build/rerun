import { assertTemplateOwnedBy, type TemplateAuthorScope } from '@/app/api/_auth/expert'
import { assertSpaceOwnedBy } from '@/app/api/_auth/ownership'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import {
    captureAgents,
    listCaptureSources,
    planCapture,
    removeCapturedAgent,
    type AgentCapturePlan,
    type CaptureOutcome,
    type CaptureSelection,
    type CaptureSourceSpace,
} from './capture'
import { AppError } from '@/lib/i18n/action-error'
import { templateEditBlockCode } from './expert'

async function requireCaptureTarget(userId: string, templateId: string): Promise<string> {
    const owned = await assertTemplateOwnedBy(userId, templateId)
    const blocked = templateEditBlockCode(owned.status)
    if (blocked) throw new AppError(blocked)
    return owned.slug
}

async function assertAgentsInSpace(agentIds: string[], spaceId: string, workspaceId: number): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMany(supabase, 'agents', ['id'] as const, { id: { in: agentIds }, space_id: spaceId, workspace_id: workspaceId })
    if ((data?.length ?? 0) !== agentIds.length) throw new AppError('selectedCoworkerNotInBox')
}

export async function listAuthorCaptureSources(scope: TemplateAuthorScope): Promise<CaptureSourceSpace[]> {
    return listCaptureSources(createServiceRoleClient(), scope.workspaceId)
}

export async function planAuthorCapture(scope: TemplateAuthorScope, input: { templateId: string; spaceId: string; agentIds: string[] }): Promise<AgentCapturePlan[]> {
    await requireCaptureTarget(scope.userId, input.templateId)
    await assertSpaceOwnedBy(scope.workspaceId, input.spaceId)
    await assertAgentsInSpace(input.agentIds, input.spaceId, scope.workspaceId)

    return planCapture(createServiceRoleClient(), input.spaceId, input.agentIds)
}

export async function captureAuthorAgents(scope: TemplateAuthorScope, input: { templateId: string; spaceId: string; selections: CaptureSelection[] }): Promise<CaptureOutcome> {
    const slug = await requireCaptureTarget(scope.userId, input.templateId)
    await assertSpaceOwnedBy(scope.workspaceId, input.spaceId)
    await assertAgentsInSpace(
        input.selections.map(selection => selection.agentRowId),
        input.spaceId,
        scope.workspaceId,
    )

    return captureAgents(createServiceRoleClient(), slug, input.spaceId, input.selections)
}

export async function removeAuthorTemplateAgent(scope: TemplateAuthorScope, input: { templateId: string; agentKey: string }): Promise<void> {
    const slug = await requireCaptureTarget(scope.userId, input.templateId)
    await removeCapturedAgent(createServiceRoleClient(), slug, input.agentKey)
}
