import 'server-only'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { sleep } from '@rerun/contracts'
import type { Locale } from '@rerun/i18n'

import { takeInvitation, type PendingInvitation } from '@/app/api/_services/invitation.service'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import type { Database, Json } from '@/app/api/database.types'
import { acceptTeamInvitation, isInTeam } from '@/ee/services/organization-team.service'
import { accountEmails } from '@/lib/auth/account-emails'
import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/notifications/prefs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'

type Client = SupabaseClient<Database>
type UserInsert = Database['public']['Tables']['users']['Insert']
type UserUpdate = Database['public']['Tables']['users']['Update']

const UNIQUE_VIOLATION = '23505'
// Another request of the same sign-in holds the invitation: its membership is a write or two away.
const OTHER_REQUEST_TRIES = 12
const OTHER_REQUEST_PACE_MS = 150

// What stands in for provisioning on an organization's address. Whoever is signed in there joins what
// the organization invited them to: an account born here opens on the workspace it was invited to,
// with no workspace of its own, no credit and no phone to give. Null for somebody it never invited,
// who is left without a place here, and for a failure, which the next request tries again.
export async function joinOrganization(user: User, organizationId: string, { locale }: { locale: Locale }): Promise<{ signedUp: boolean } | null> {
    const supabase = createServiceRoleClient()
    const { data: account, error } = await selectMaybeSingle(supabase, 'users', ['id', 'signed_up_at'] as const, { id: user.id })
    if (error) {
        console.error('[organizations] could not read the account of someone signing in', error)
        return null
    }

    try {
        const emails = accountEmails(user)
        let exists = !!account
        for (const invitation of await pendingInvitations(supabase, organizationId, emails)) {
            exists = (await join(supabase, user, invitation, exists)) || exists
        }
        const teamTokens = await pendingTeamInvitations(supabase, organizationId, emails)
        if (teamTokens.length > 0 || (await isInTeam(organizationId, user.id))) exists ||= await openTeamAccount(supabase, user, locale)
        for (const token of exists ? teamTokens : []) await acceptTeamInvitation(user, token).catch(err => console.warn('[organizations] a team invitation was not accepted', err))

        if (!exists || !(await hasPlace(supabase, organizationId, user.id))) return null
        if (account && !account.signed_up_at) await stampWithoutCredit(supabase, user.id)
        return { signedUp: true }
    } catch (err) {
        console.error('[organizations] joining failed', err)
        return null
    }
}

async function workspacesOf(supabase: Client, organizationId: string, workspaceIds: number[]): Promise<Set<number>> {
    if (workspaceIds.length === 0) return new Set()
    const { data, error } = await selectMany(supabase, 'workspaces', ['id'] as const, { id: workspaceIds, organization_id: organizationId })
    if (error) throw new Error(error.message)
    return new Set((data ?? []).map(workspace => workspace.id))
}

async function pendingInvitations(supabase: Client, organizationId: string, emails: string[]): Promise<PendingInvitation[]> {
    if (emails.length === 0) return []
    const { data, error } = await selectMany(
        supabase,
        'workspace_invitations',
        ['id', 'workspace_id', 'box_scope', 'role'] as const,
        { email: emails, status: 'pending', expires_at: { gt: new Date().toISOString() } },
        { column: 'created_at', ascending: true },
    )
    if (error) throw new Error(error.message)
    const here = await workspacesOf(supabase, organizationId, (data ?? []).map(row => row.workspace_id))
    return (data ?? []).filter(row => here.has(row.workspace_id))
}

async function pendingTeamInvitations(supabase: Client, organizationId: string, emails: string[]): Promise<string[]> {
    if (emails.length === 0) return []
    const { data, error } = await selectMany(supabase, 'organization_invitations', ['token'] as const, { organization_id: organizationId, email: emails, status: 'pending', expires_at: { gt: new Date().toISOString() } })
    if (error) throw new Error(error.message)
    return (data ?? []).map(row => row.token)
}

// Whether they ended up in the workspace. The requests of a first page load arrive together: one takes
// the invitation, the others wait for what it writes.
async function join(supabase: Client, user: User, invitation: PendingInvitation, exists: boolean): Promise<boolean> {
    const taken = await takeInvitation(supabase, user.id, invitation, exists ? undefined : () => insertAccount(supabase, user.id, invitation.workspace_id))
    if (taken.ok) return true
    if (taken.reason === 'claimed') return waitForMembership(supabase, user.id, invitation.workspace_id)
    console.warn('[organizations] an invitation was not taken', taken)
    return false
}

async function waitForMembership(supabase: Client, userId: string, workspaceId: number): Promise<boolean> {
    for (let attempt = 0; attempt < OTHER_REQUEST_TRIES; attempt++) {
        const { data } = await selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { user_id: userId, workspace_id: workspaceId })
        if (data) return true
        await sleep(OTHER_REQUEST_PACE_MS)
    }
    return false
}

// Written once the invitation is theirs: an account pointing at a workspace it may not open would be
// shut out everywhere.
async function insertAccount(supabase: Client, userId: string, workspaceId: number): Promise<string | null> {
    const { error } = await supabase
        .from('users')
        .insert<UserInsert>({ id: userId, workspace_id: workspaceId, email_notification_prefs: DEFAULT_NOTIFICATION_PREFS as unknown as Json, signed_up_at: new Date().toISOString() })
    return !error || error.code === UNIQUE_VIOLATION ? null : error.message
}

// The team of an organization works in its clients' workspaces and is in none of them until it opens
// one, and an account has to have a workspace: one of its own, without credit, that an organization's
// address never shows. Another request of the same sign-in may have written it first.
async function openTeamAccount(supabase: Client, user: User, locale: Locale): Promise<boolean> {
    if (await provisionUser(supabase, user, { phoneStep: false, locale, ownWorkspace: 'bare' })) return true
    const { data } = await selectMaybeSingle(supabase, 'users', ['id'] as const, { id: user.id })
    return !!data
}

async function hasPlace(supabase: Client, organizationId: string, userId: string): Promise<boolean> {
    if (await isInTeam(organizationId, userId)) return true
    const { data, error } = await selectMany(supabase, 'workspace_members', ['workspace_id'] as const, { user_id: userId })
    if (error) throw new Error(error.message)
    return (await workspacesOf(supabase, organizationId, (data ?? []).map(row => row.workspace_id))).size > 0
}

async function stampWithoutCredit(supabase: Client, userId: string): Promise<void> {
    const { error } = await supabase.from('users').update<UserUpdate>({ signed_up_at: new Date().toISOString() }).eq('id', userId).is('signed_up_at', null)
    if (error) throw new Error(error.message)
}
