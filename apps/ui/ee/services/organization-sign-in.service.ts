import 'server-only'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Brand } from '@rerun/contracts'
import type { Locale } from '@rerun/i18n'
import { after } from 'next/server'

import type { Database } from '@/app/api/database.types'
import { claimEmailCodeAsk, claimInvitedCodeAsk } from '@/app/api/_services/email-sign-up.service'
import { accountOfLiveCode, rememberSignInCode, resendSignInCodeIfLive, SIGN_IN_CODE_TTL_MINUTES, signInUrlFor } from '@/app/api/_services/sign-in-code.service'
import { brandReachedBy } from '@/ee/services/organization-reach.service'
import { accountEmails } from '@/lib/auth/account-emails'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectCount, selectMany } from '@/supabase/supabase-helpers'
import { sendSignInCodeEmail } from '@rerun/cloud/email'

type Client = SupabaseClient<Database>

export type InvitedSignIn = { organizationId: string; brand: Brand; email: string; ip: string; locale: Locale }
export type InvitedSignInOutcome = 'asked' | 'too_many'

// The sign-in of an organization's address, which its members and whoever it invited alone may use.
// The answer says nothing of the address, not even by the time it takes: what decides and what mails
// runs once it has left. No robot check is needed for it, a code never goes to an address nobody here
// vouches for; the pace does, per network and per address.
export async function askInvitedSignInCode(ask: InvitedSignIn): Promise<InvitedSignInOutcome> {
    const [network, address] = await Promise.all([claimEmailCodeAsk(ask.ip), claimInvitedCodeAsk(ask.organizationId, ask.email)])
    if (!network || !address) return 'too_many'
    after(() => mailCode(ask).catch(err => console.error('[organizations] a sign-in code could not be mailed', err)))
    return 'asked'
}

export async function mailCode({ organizationId, brand, email, locale }: InvitedSignIn): Promise<void> {
    const supabase = createServiceRoleClient()
    // Settled before anything touches the account: minting a code voids the last one, and a stranger's
    // sign-in elsewhere is nobody's here to break.
    const invited = await isInvited(supabase, organizationId, email)
    if (!invited && !(await isOrganizationPerson(supabase, organizationId, email))) return

    const live = await accountOfLiveCode(email)
    if (live && (await resendSignInCodeIfLive(email, null, await brandReachedBy(live, organizationId, brand)))) return

    const account = await accountFor(supabase, email, { mayOpen: invited })
    if (!account) return
    const { user, code, tokenHash, type } = account
    // The link of the email signs in where it leads: never on a domain of the organization's own for
    // an account that also works elsewhere.
    const signInBrand = await brandReachedBy(user.id, organizationId, brand)
    const sent = await sendSignInCodeEmail({ to: email, code, signInUrl: signInUrlFor(tokenHash, type, signInBrand), expiresInMinutes: SIGN_IN_CODE_TTL_MINUTES, locale, brand: signInBrand })
    if (sent.ok) await rememberSignInCode({ email, userId: user.id, type, code, tokenHash })
}

type MintedCode = { user: User; code: string; tokenHash: string; type: string }

// The code is minted here rather than by the browser's own ask to Supabase, whose answer tells an
// address that has an account from one that has none. Only asked for an address no live code was
// mailed to, so it voids none.
async function accountFor(supabase: Client, email: string, { mayOpen }: { mayOpen: boolean }): Promise<MintedCode | null> {
    const { data: exists, error } = await supabase.rpc('check_email_exists', { email })
    if (error) throw new Error(error.message)
    if (!exists) {
        if (!mayOpen) return null
        // The invitation vouches for the address, and the code mailed next is what proves it.
        const { error: createError } = await supabase.auth.admin.createUser({ email })
        if (createError && createError.code !== 'email_exists') throw new Error(createError.message)
    }
    const { data, error: linkError } = await supabase.auth.admin.generateLink({ type: 'magiclink', email })
    if (linkError) throw new Error(linkError.message)
    return { user: data.user, code: data.properties.email_otp, tokenHash: data.properties.hashed_token, type: data.properties.verification_type }
}

async function isInvited(supabase: Client, organizationId: string, email: string): Promise<boolean> {
    const now = new Date().toISOString()
    const { data: team, error: teamError } = await selectCount(supabase, 'organization_invitations', { organization_id: organizationId, email, status: 'pending', expires_at: { gt: now } })
    if (teamError) throw new Error(teamError.message)
    if (team) return true

    const { data: invitations, error } = await selectMany(supabase, 'workspace_invitations', ['workspace_id'] as const, { email, status: 'pending', expires_at: { gt: now } })
    if (error) throw new Error(error.message)
    return countWorkspacesOf(supabase, organizationId, (invitations ?? []).map(row => row.workspace_id)).then(count => count > 0)
}

async function countWorkspacesOf(supabase: Client, organizationId: string, workspaceIds: number[]): Promise<number> {
    if (workspaceIds.length === 0) return 0
    const { data, error } = await selectCount(supabase, 'workspaces', { id: workspaceIds, organization_id: organizationId })
    if (error) throw new Error(error.message)
    return data ?? 0
}

// In its team, or in one of its workspaces, its team's rows included: whoever may open something here.
async function isOrganizationPerson(supabase: Client, organizationId: string, email: string): Promise<boolean> {
    const [{ data: team, error: teamError }, { data: workspaces, error: workspacesError }] = await Promise.all([
        selectAll(supabase, 'organization_members', ['user_id'] as const, { organization_id: organizationId }),
        selectAll(supabase, 'workspaces', ['id'] as const, { organization_id: organizationId }),
    ])
    if (teamError) throw new Error(teamError.message)
    if (workspacesError) throw new Error(workspacesError.message)
    const workspaceIds = workspaces.map(workspace => workspace.id)
    const { data: members, error } = workspaceIds.length ? await selectAll(supabase, 'workspace_members', ['user_id'] as const, { workspace_id: workspaceIds }) : { data: [], error: null }
    if (error) throw new Error(error.message)

    const people = new Set([...team, ...members].map(row => row.user_id))
    for (const id of people) {
        const { data } = await supabase.auth.admin.getUserById(id)
        if (data.user && accountEmails(data.user).includes(email)) return true
    }
    return false
}
