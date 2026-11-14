import { toBoxScope, type BoxScope } from '@/app/api/_auth/box-scope'
import { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'
import { realEmail } from '@/lib/auth/placeholder-email'
import type { Database, Enums } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession, getSessionWorkspace } from '@/supabase/session/getServerSession'
import { selectMany, selectMaybeSingle, selectMaybeSingleWithJoins, selectSingle } from '@/supabase/supabase-helpers'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { ErrorCode } from '@/lib/i18n/action-error'

export { AuthorizationError, UnauthenticatedError } from '@/app/api/_auth/errors'

const NOT_A_MEMBER = 'notMember' satisfies ErrorCode

export type WorkspaceRole = Enums<'workspace_role'>

export { toBoxScope, type BoxScope } from '@/app/api/_auth/box-scope'

export async function requireWorkspaceId(): Promise<number> {
    const { user, workspaceRefused } = await getSessionWorkspace()
    if (workspaceRefused) throw new AuthorizationError(NOT_A_MEMBER)
    if (!user?.workspace_id) throw new UnauthenticatedError()
    return user.workspace_id
}

export type WorkspaceContext = {
    userId: string
    userEmail: string | null
    authUser: User
    workspace: NonNullable<Awaited<ReturnType<typeof getServerSession>>['workspace']>
    role: WorkspaceRole
    boxScope: BoxScope
    supabase: SupabaseClient<Database>
}

export async function requireWorkspaceContext(): Promise<WorkspaceContext> {
    const { user, workspace, session, workspaceRefused } = await getServerSession()
    if (workspaceRefused) throw new AuthorizationError(NOT_A_MEMBER)
    if (!user?.id || !user.workspace_id || !workspace || !session) throw new UnauthenticatedError()

    const supabase = createServiceRoleClient()
    const { data: membership } = await selectMaybeSingle(supabase, 'workspace_members', ['role', 'box_scope'] as const, { user_id: user.id, workspace_id: workspace.id })
    if (!membership) throw new AuthorizationError(NOT_A_MEMBER)

    return { userId: user.id, userEmail: realEmail(session.email), authUser: session, workspace, role: membership.role, boxScope: toBoxScope(membership.box_scope), supabase }
}

export const ADMIN_ONLY = 'adminOnly' satisfies ErrorCode

export async function requireAdminContext(code: ErrorCode = ADMIN_ONLY): Promise<WorkspaceContext> {
    const ctx = await requireWorkspaceContext()
    if (ctx.role !== 'admin') throw new AuthorizationError(code)
    return ctx
}

type OwnedSpace = { workspace_id: number }

export async function assertSpaceOwnedBy(workspaceId: number, spaceId: string): Promise<OwnedSpace> {
    const supabase = createServiceRoleClient()
    const { data: space } = await selectSingle(supabase, 'spaces', ['workspace_id'] as const, { id: spaceId })
    if (!space || space.workspace_id !== workspaceId) throw new AuthorizationError('spaceNotFound')
    return space
}

export async function assertSpaceInWorkspace(spaceId: string): Promise<OwnedSpace> {
    return assertSpaceOwnedBy(await requireWorkspaceId(), spaceId)
}

export async function workspaceFounderUserId(workspaceId: number): Promise<string | null> {
    const supabase = createServiceRoleClient()
    const { data: members } = await selectMany(supabase, 'workspace_members', ['user_id', 'role'] as const, { workspace_id: workspaceId }, { column: 'created_at' })
    return earliestAdminFirst(members ?? [])?.user_id ?? null
}

export function earliestAdminFirst<T extends { role: WorkspaceRole }>(membersByAge: T[]): T | undefined {
    return membersByAge.find(m => m.role === 'admin') ?? membersByAge[0]
}
