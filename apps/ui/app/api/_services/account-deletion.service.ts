import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { stopWorkspaceCharges, subscriptionStillCharges, uninstallWorkspaceApps } from '@rerun/cloud/account'
import type { AccountDeletionBlocker } from '@/lib/auth/account-deletion'
import { isStoreProvider, type BillingProvider } from '@rerun/contracts'
import { deletedAccountEmailFor } from '@/lib/auth/placeholder-email'
import { DEFAULT_WORKSPACE_NAME } from '@/lib/naming/workspace-name'
import { isLastAdmin, setMemberRole } from '@/app/api/_services/members.service'
import { selectAll, selectMany } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type AgentUpdate = Database['public']['Tables']['agents']['Update']
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']
type UserUpdate = Database['public']['Tables']['users']['Update']
type NewsletterRecipientUpdate = Database['public']['Tables']['newsletter_recipients']['Update']

export const ACCOUNT_DELETED_REASON = 'account_deleted'

const USER_AVATARS_BUCKET = 'user-avatars'
const WORKSPACE_COLUMNS = ['id', 'name', 'is_sandbox', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'billing_provider', 'subscription_cancel_at'] as const
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
const STORE_RENEWING_STATUSES = new Set(['active', 'trialing', 'past_due'])

type OwnWorkspace = {
    id: number
    name: string
    isSandbox: boolean
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    subscriptionStatus: string | null
    billingProvider: string | null
    subscriptionCancelAt: string | null
    shared: boolean
}

async function workspacesOf(admin: Client, userId: string): Promise<OwnWorkspace[]> {
    const { data: memberships, error } = await selectAll(admin, 'workspace_members', ['workspace_id'] as const, { user_id: userId })
    if (error) throw new Error(error.message)
    const ids = memberships.map(membership => membership.workspace_id)
    if (ids.length === 0) return []

    const [{ data: workspaces, error: workspacesError }, { data: members, error: membersError }] = await Promise.all([selectAll(admin, 'workspaces', WORKSPACE_COLUMNS, { id: ids }), selectAll(admin, 'workspace_members', ['workspace_id', 'user_id'] as const, { workspace_id: ids })])
    if (workspacesError) throw new Error(workspacesError.message)
    if (membersError) throw new Error(membersError.message)

    return workspaces.map(workspace => ({
        id: workspace.id,
        name: workspace.name ?? DEFAULT_WORKSPACE_NAME,
        isSandbox: workspace.is_sandbox,
        stripeCustomerId: workspace.stripe_customer_id,
        stripeSubscriptionId: workspace.stripe_subscription_id,
        subscriptionStatus: workspace.subscription_status,
        billingProvider: workspace.billing_provider,
        subscriptionCancelAt: workspace.subscription_cancel_at,
        shared: members.some(member => member.workspace_id === workspace.id && member.user_id !== userId),
    }))
}

// The workspaces only this user is left in, whose subscription has to be cancelled through the
// billing flow before the account can go. Shared workspaces carry on with their other members.
//
// A store's subscription renews until it is cancelled in that store, which only its owner can do: Rerun
// has no way to stop it, so it blocks as long as it renews, and is told apart for the copy.
async function blockersAmong(workspaces: OwnWorkspace[]): Promise<AccountDeletionBlocker[]> {
    const own = workspaces.filter(workspace => !workspace.shared)
    // A store retrying a failed renewal still renews.
    const store = own.filter(workspace => isStoreProvider(workspace.billingProvider) && STORE_RENEWING_STATUSES.has(workspace.subscriptionStatus ?? ''))
    const candidates = own.filter(workspace => !isStoreProvider(workspace.billingProvider) && workspace.stripeSubscriptionId && LIVE_SUBSCRIPTION_STATUSES.has(workspace.subscriptionStatus ?? ''))
    const charging = await Promise.all(candidates.map(workspace => subscriptionStillCharges(workspace.stripeSubscriptionId!)))
    return [
        ...candidates.filter((_, index) => charging[index]).map(workspace => ({ workspaceId: workspace.id, name: workspace.name })),
        ...store.filter(workspace => !workspace.subscriptionCancelAt).map(workspace => ({ workspaceId: workspace.id, name: workspace.name, billedBy: workspace.billingProvider as BillingProvider })),
    ]
}

export async function accountDeletionBlockers(admin: Client, userId: string): Promise<AccountDeletionBlocker[]> {
    return blockersAmong(await workspacesOf(admin, userId))
}

// The last admin leaving hands the workspace to the earliest member, so it is never left with no one
// who can pay for it or let anyone in.
async function leaveSharedWorkspace(admin: Client, userId: string, workspace: OwnWorkspace) {
    if (await isLastAdmin(admin, workspace.id, userId)) {
        const { data: members } = await selectMany(admin, 'workspace_members', ['user_id'] as const, { workspace_id: workspace.id, user_id: { neq: userId } }, { column: 'created_at' }, 1)
        const heir = members?.[0]
        if (heir) {
            const { error } = await setMemberRole(admin, workspace.id, heir.user_id, 'admin')
            if (error) throw new Error(error)
        }
    }
    const { error } = await admin.from('workspace_members').delete().eq('workspace_id', workspace.id).eq('user_id', userId)
    if (error) throw new Error(error.message)
}

// The workspace, its agents and its Boxes stay, with the membership that ties them to the
// anonymized user: they are what a bug report is traced back through. Only what costs or runs goes.
async function shutDownOwnWorkspace(admin: Client, workspace: OwnWorkspace) {
    await stopWorkspaceCharges(admin, workspace)

    if (!workspace.isSandbox) {
        const { error } = await admin.from('workspaces').update<WorkspaceUpdate>({ boxes_deleted_at: new Date().toISOString() }).eq('id', workspace.id)
        if (error) throw new Error(error.message)
    }

    const { error } = await admin.from('agents').update<AgentUpdate>({ disabled_at: new Date().toISOString(), disabled_reason: ACCOUNT_DELETED_REASON }).eq('workspace_id', workspace.id).is('disabled_at', null)
    if (error) throw new Error(error.message)

    await uninstallWorkspaceApps(admin, workspace.id)
}

async function erasePersonalData(admin: Client, userId: string) {
    const deletions = await Promise.all([
        admin.from('user_phones').delete().eq('user_id', userId),
        admin.from('sign_in_codes').delete().eq('user_id', userId),
        admin.from('user_presence').delete().eq('user_id', userId),
        admin
            .from('newsletter_recipients')
            .update<NewsletterRecipientUpdate>({ email: deletedAccountEmailFor(userId) })
            .eq('user_id', userId),
    ])
    const failed = deletions.find(result => result.error)
    if (failed?.error) throw new Error(failed.error.message)

    const avatars = await admin.storage.from(USER_AVATARS_BUCKET).list(userId)
    const paths = (avatars.data ?? []).map(file => `${userId}/${file.name}`)
    if (paths.length > 0) {
        const { error } = await admin.storage.from(USER_AVATARS_BUCKET).remove(paths)
        if (error) throw new Error(error.message)
    }

    const { error } = await admin.from('users').update<UserUpdate>({ deleted_at: new Date().toISOString(), onboarding_answers: null }).eq('id', userId)
    if (error) throw new Error(error.message)
}

/**
 * Deletes an account the way Rerun does: the rows stay, nothing in them points to the person any
 * more, and nobody can sign into them again. Every step can run twice, and the auth row goes last,
 * so a failure halfway leaves a session the user can retry from.
 */
export async function anonymizeAccount(admin: Client, userId: string): Promise<{ ok: true } | { ok: false; blockers: AccountDeletionBlocker[] }> {
    const workspaces = await workspacesOf(admin, userId)
    const blockers = await blockersAmong(workspaces)
    if (blockers.length > 0) return { ok: false, blockers }

    for (const workspace of workspaces) {
        if (workspace.shared) await leaveSharedWorkspace(admin, userId, workspace)
        else await shutDownOwnWorkspace(admin, workspace)
    }

    await erasePersonalData(admin, userId)

    const { error } = await admin.rpc('anonymize_auth_user', { p_user_id: userId, p_email: deletedAccountEmailFor(userId) })
    if (error) throw new Error(error.message)
    return { ok: true }
}
