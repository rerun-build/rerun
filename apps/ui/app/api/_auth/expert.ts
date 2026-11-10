import { createServiceRoleClient } from '@/supabase/serviceRole'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { ErrorCode } from '@/lib/i18n/action-error'
import { AuthorizationError, requireWorkspaceId, workspaceFounderUserId } from './ownership'

// Same reason to exist as ownership.ts: the expert surfaces write through the service-role client,
// which bypasses RLS, so authorization is re-established in code. The difference is what scopes it:
// templates hang off a user (`templates.creator_id`), not off a workspace.

export const EXPERT_ACCOUNT_ROLE = 'expert'

// `getServerSession` does not select `account_role`, so the role is re-read here. Kept separate
// from requireExpertUserId so enterSandboxAction can answer with its own copy instead of throwing.
export async function isExpertAccount(userId: string): Promise<boolean> {
    const supabase = createServiceRoleClient()
    const { data: account } = await selectMaybeSingle(supabase, 'users', ['account_role'] as const, { id: userId })
    return account?.account_role === EXPERT_ACCOUNT_ROLE
}

// The creator program wall. Answers "is this account a creator who still owes us the program
// conditions", which is the only thing that stands between them and their sandbox.
//
// `creator_joined_at` is what scopes it: it is only ever written by the join flow, so an expert
// account flagged by hand before the program existed is never gated and lands straight on its
// sandbox.
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

// Who is authoring, and from where. Both halves of the answer travel together because a capture
// needs the workspace and a template needs the user, and they have to belong to each other.
export type TemplateAuthorScope = { userId: string; workspaceId: number }

// A capture ships a whole agent folder to a page anyone can install from, so it may only source
// from the sandbox: doing it from a real workspace would put a client's memories on the internet.
async function assertSandboxWorkspace(workspaceId: number, code: ErrorCode): Promise<void> {
    const supabase = createServiceRoleClient()
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['is_sandbox'] as const, { id: workspaceId })
    if (!workspace?.is_sandbox) throw new AuthorizationError(code)
}

// The browser half of the useIsTemplateAuthor gate: the session knows both the user and the
// workspace they are looking at.
export async function requireSandboxAuthorSession(): Promise<TemplateAuthorScope> {
    const userId = await requireExpertUserId()
    const workspaceId = await requireWorkspaceId()
    await assertSandboxWorkspace(workspaceId, 'captureSandboxOnly')
    return { userId, workspaceId }
}

export async function requireSandboxWorkspaceId(): Promise<number> {
    return (await requireSandboxAuthorSession()).workspaceId
}

// The MCP half. An API key names no user, so the author is the workspace's founder, and both rules
// the browser path enforces still have to hold. Anything else fails here rather than filing a
// template under someone who never asked for one.
export async function requireSandboxAuthorKey(workspaceId: number): Promise<TemplateAuthorScope> {
    await assertSandboxWorkspace(workspaceId, 'templateKeyNotSandbox')

    const userId = await workspaceFounderUserId(workspaceId)
    if (!userId) throw new AuthorizationError('templateKeyNoMember')

    if (!(await isExpertAccount(userId))) throw new AuthorizationError('templateAuthoringExpertOnly')

    return { userId, workspaceId }
}

export type OwnedTemplate = { id: string; slug: string; status: string }

// Addressed by id: the panel has no route to push, and the slug can move under an admin edit. The
// slug is resolved here rather than accepted from the client. `selectMaybeSingle` and not
// `selectSingle` so "does not exist" and "not yours" are the same answer.
export async function assertTemplateOwnedBy(userId: string, id: string): Promise<OwnedTemplate> {
    const supabase = createServiceRoleClient()
    const { data: template } = await selectMaybeSingle(supabase, 'templates', ['id', 'slug', 'status'] as const, { id, creator_id: userId })
    if (!template) throw new AuthorizationError('templateNotFound')
    return template
}

export async function assertTemplateOwnedByUser(id: string): Promise<OwnedTemplate> {
    return assertTemplateOwnedBy(await requireExpertUserId(), id)
}
