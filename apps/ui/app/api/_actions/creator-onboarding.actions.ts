'use server'

import { captureServer, deterministicUuid } from '@rerun/analytics/server'
import { expertDistinctId } from '@rerun/analytics'

import type { Database } from '@/app/api/database.types'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { EXPERT_ACCOUNT_ROLE } from '@/app/api/_auth/expert'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { enterSandbox } from '@/app/api/_services/sandbox.service'
import { getServerSession } from '@/supabase/session/getServerSession'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

import { failure } from '@/lib/i18n/action-error'
import type { ActionResult } from './space.actions'

// The creator side of the join link. `experts.creator_token` is the capability that turns an
// invited expert into an account with a sandbox, so it is resolved here with the service-role
// client and never handed back to the browser beyond what the welcome screen needs to display.
//
// The token itself is the authorization: it is only minted when the email leaves, so holding one
// means an admin sent it. What can still retire it is the fiche being turned down or opted out.

const INVITE_COLUMNS = ['id', 'name', 'email', 'slug', 'status', 'application_status', 'creator_token', 'creator_terms_accepted_at'] as const

type InviteGate = { status: string; application_status: string | null }

function isInviteOpen(expert: InviteGate): boolean {
    return expert.status !== 'declined' && expert.application_status !== 'rejected'
}

export type CreatorInvite = {
    expertId: string
    name: string
    email: string | null
    // Already attached to the caller's account, so the wizard resumes at the conditions.
    claimed: boolean
    // Attached to somebody else's account: the link is spent.
    takenByAnother: boolean
    termsAccepted: boolean
}

export type LoadCreatorInviteResult = { status: 'ok'; invite: CreatorInvite } | { status: 'not_found' } | { status: 'not_accepted' }

type ServiceClient = ReturnType<typeof createServiceRoleClient>

async function requireUserId(): Promise<string> {
    const { user } = await getServerSession()
    if (!user?.id) throw new AuthorizationError('notAuthenticated')
    return user.id
}

async function linkedUserId(supabase: ServiceClient, expertId: string): Promise<string | null> {
    const { data } = await selectMaybeSingle(supabase, 'users', ['id'] as const, { expert_profile_id: expertId })
    return data?.id ?? null
}

export async function loadCreatorInviteAction(token: string): Promise<LoadCreatorInviteResult> {
    const supabase = createServiceRoleClient()

    const { data: expert } = await selectMaybeSingle(supabase, 'experts', INVITE_COLUMNS, { creator_token: token })
    if (!expert) return { status: 'not_found' }
    if (!isInviteOpen(expert)) return { status: 'not_accepted' }

    // The link never expires: what retires it is the fiche ending up on an account. Whose account
    // that is only matters once there is a real session, so the answer travels back as a flag and
    // the page decides between "sign in first" and "this link is spent".
    const owner = await linkedUserId(supabase, expert.id)
    const { user } = await getServerSession()

    return {
        status: 'ok',
        invite: {
            expertId: expert.id,
            name: expert.name,
            email: expert.email,
            claimed: Boolean(owner) && owner === user?.id,
            takenByAnother: Boolean(owner) && owner !== user?.id,
            termsAccepted: Boolean(expert.creator_terms_accepted_at),
        },
    }
}

// The resume path: the terms wall sends people to /creator/join without a token, so the fiche is
// resolved from the account instead.
export async function loadOwnCreatorInviteAction(): Promise<LoadCreatorInviteResult> {
    const userId = await requireUserId()
    const supabase = createServiceRoleClient()

    const { data: account } = await selectMaybeSingle(supabase, 'users', ['expert_profile_id'] as const, { id: userId })
    if (!account?.expert_profile_id) return { status: 'not_found' }

    const { data: expert } = await selectMaybeSingle(supabase, 'experts', INVITE_COLUMNS, { id: account.expert_profile_id })
    if (!expert) return { status: 'not_found' }
    // No token means nothing was ever sent, so there is no invitation to resume either.
    if (!expert.creator_token || !isInviteOpen(expert)) return { status: 'not_accepted' }

    return {
        status: 'ok',
        invite: {
            expertId: expert.id,
            name: expert.name,
            email: expert.email,
            claimed: true,
            takenByAnother: false,
            termsAccepted: Boolean(expert.creator_terms_accepted_at),
        },
    }
}

// Attaches the fiche to the caller's account, flags it expert, and opens the sandbox. Idempotent
// from end to end: `enterSandbox` is get-or-create, so someone who already has a sandbox reuses it
// instead of collecting a second engine.
export async function claimCreatorSandboxAction(token?: string): Promise<ActionResult<{ workspaceId: number }>> {
    const { user, session, isAnonymous } = await getServerSession()
    if (!user?.id || isAnonymous || !session?.email) return failure('signInToClaimCreator')
    const userId = user.id
    const supabase = createServiceRoleClient()

    const { data: account } = await selectMaybeSingle(supabase, 'users', ['expert_profile_id'] as const, { id: userId })

    const ownProfileId = account?.expert_profile_id ?? null
    const filter = token ? { creator_token: token } : ownProfileId ? { id: ownProfileId } : null
    if (!filter) return failure('noCreatorProfile')

    const { data: expert } = await selectMaybeSingle(supabase, 'experts', ['id', 'slug', 'email', 'status', 'application_status'] as const, filter)
    if (!expert) return failure('linkInvalid')
    if (!isInviteOpen(expert)) return failure('creatorInviteClosed')

    const owner = await linkedUserId(supabase, expert.id)
    if (owner && owner !== userId) return failure('creatorProfileTaken')
    if (ownProfileId && ownProfileId !== expert.id) return failure('accountHasOtherCreatorProfile')
    if (!owner && expert.email?.toLowerCase() !== session.email.toLowerCase()) return failure('invitationOtherEmail')

    if (!owner) {
        const { error } = await supabase
            .from('users')
            .update<Database['public']['Tables']['users']['Update']>({ account_role: EXPERT_ACCOUNT_ROLE, expert_profile_id: expert.id })
            .eq('id', userId)
        if (error) return { ok: false, error: error.message }

        const now = new Date().toISOString()
        await supabase
            .from('experts')
            .update<Database['public']['Tables']['experts']['Update']>({ creator_joined_at: now, updated_at: now })
            .eq('id', expert.id)

        await captureServer(expertDistinctId({ id: expert.id, email: expert.email }), 'creator_sandbox_claimed', { expert_id: expert.id, expert_slug: expert.slug }, {
            uuid: deterministicUuid(`creator_sandbox_claimed:${expert.id}`),
        })
    }

    return enterSandbox(userId)
}

// The conditions themselves are not stored: what is checked in the browser is a display detail, and
// a new version of the program is announced, not re-signed retroactively.
export async function acceptCreatorTermsAction(): Promise<ActionResult> {
    const userId = await requireUserId()
    const supabase = createServiceRoleClient()

    const { data: account } = await selectMaybeSingle(supabase, 'users', ['expert_profile_id'] as const, { id: userId })
    if (!account?.expert_profile_id) return failure('noCreatorProfile')

    const { data: expert } = await selectMaybeSingle(supabase, 'experts', ['id', 'slug', 'email', 'status', 'application_status'] as const, { id: account.expert_profile_id })
    if (!expert) return failure('noCreatorProfile')
    if (!isInviteOpen(expert)) return failure('creatorInviteClosed')

    const now = new Date().toISOString()
    const { error } = await supabase
        .from('experts')
        .update<Database['public']['Tables']['experts']['Update']>({ creator_terms_accepted_at: now, updated_at: now })
        .eq('id', expert.id)
    if (error) return { ok: false, error: error.message }

    await captureServer(expertDistinctId({ id: expert.id, email: expert.email }), 'creator_terms_accepted', { expert_id: expert.id, expert_slug: expert.slug }, {
        uuid: deterministicUuid(`creator_terms_accepted:${expert.id}`),
    })

    return { ok: true }
}
