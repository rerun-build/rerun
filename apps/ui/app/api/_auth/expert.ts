import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { ErrorCode } from '@/lib/i18n/action-error'
import { AuthorizationError, requireWorkspaceId, workspaceFounderUserId } from './ownership'

export const EXPERT_ACCOUNT_ROLE = 'expert'

export async function isExpertAccount(userId: string): Promise<boolean> {
    const supabase = createServiceRoleClient()
    const { data: account } = await selectMaybeSingle(supabase, 'users', ['account_role'] as const, { id: userId })
    return account?.account_role === EXPERT_ACCOUNT_ROLE
}

export async function hasPendingCreatorTerms(userId: string): Promise<boolean> {
    const supabase = createServiceRoleClient()

    const { data: account } = await selectMaybeSingle(supabase, 'users', ['account_role', 'expert_profile_id'] as const, { id: userId })
    if (account?.account_role !== EXPERT_ACCOUNT_ROLE || !account.expert_profile_id) return false

    const { data: expert } = await selectMaybeSingle(supabase, 'experts', ['creator_joined_at', 'creator_terms_accepted_at'] as const, { id: account.expert_profile_id })
    if (!expert?.creator_joined_at) return false

    return !expert.creator_terms_accepted_at
}

export async function requireExpertUserId(): Promise<string> {
    const { user } = await getServerSession()
    if (!user?.id) throw new AuthorizationError('notAuthenticated')
    if (!(await isExpertAccount(user.id))) throw new AuthorizationError('expertOnly')
    return user.id
}

export type TemplateAuthorScope = { userId: string; workspaceId: number }

async function assertSandboxWorkspace(workspaceId: number, code: ErrorCode): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['is_sandbox'] as const, { id: workspaceId })
    if (!workspace?.is_sandbox) throw new AuthorizationError(code)
}

export async function requireSandboxAuthorSession(): Promise<TemplateAuthorScope> {
    const userId = await requireExpertUserId()
    const workspaceId = await requireWorkspaceId()
    await assertSandboxWorkspace(workspaceId, 'captureSandboxOnly')
    return { userId, workspaceId }
}

export async function requireSandboxWorkspaceId(): Promise<number> {
    return (await requireSandboxAuthorSession()).workspaceId
}

export async function requireSandboxAuthorKey(workspaceId: number): Promise<TemplateAuthorScope> {
    await assertSandboxWorkspace(workspaceId, 'templateKeyNotSandbox')

    const userId = await workspaceFounderUserId(workspaceId)
    if (!userId) throw new AuthorizationError('templateKeyNoMember')

    if (!(await isExpertAccount(userId))) throw new AuthorizationError('templateAuthoringExpertOnly')

    return { userId, workspaceId }
}

export type OwnedTemplate = { id: string; slug: string; status: string }

export async function assertTemplateOwnedBy(userId: string, id: string): Promise<OwnedTemplate> {
    const supabase = createServiceRoleClient()
    const { data: template } = await selectMaybeSingle(supabase, 'templates', ['id', 'slug', 'status'] as const, { id, creator_id: userId })
    if (!template) throw new AuthorizationError('templateNotFound')
    return template
}

export async function assertTemplateOwnedByUser(id: string): Promise<OwnedTemplate> {
    return assertTemplateOwnedBy(await requireExpertUserId(), id)
}
