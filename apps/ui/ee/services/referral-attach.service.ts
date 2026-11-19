import type { Database } from '@/app/api/database.types'
import { REFERRAL_CODE_PATTERN } from '@/ee/lib/billing/referral'
import { displayNameOf } from '@/lib/auth/user-profile'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { User } from '@supabase/supabase-js'

// What the request path needs of the referral links (the middleware provisioning an account, the
// `/i/<code>` route, the sign-in naming who invited), kept apart from the referral service so none
// of them pulls Stripe in.

export function firstNameOf(user: Pick<User, 'app_metadata' | 'user_metadata' | 'email'>): string | null {
    return displayNameOf(user)?.split(/\s+/)[0] ?? null
}

export async function userById(userId: string): Promise<User | null> {
    const { data } = await createServiceRoleClient().auth.admin.getUserById(userId)
    return data.user ?? null
}

export async function codeOwner(code: string | null | undefined): Promise<{ code: string; workspace_id: number; user_id: string } | null> {
    if (!code || !REFERRAL_CODE_PATTERN.test(code)) return null
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'referral_codes', ['code', 'workspace_id', 'user_id'] as const, { code })
    return data ?? null
}

export async function isReferralCode(code: string | null | undefined): Promise<boolean> {
    return !!(await codeOwner(code))
}

// A referrer's first name, null when their account has none to show (an Apple relay address).
export type Referrer = { firstName: string | null }

async function referrerOf(userId: string): Promise<Referrer> {
    const user = await userById(userId)
    return { firstName: user ? firstNameOf(user) : null }
}

// Who the sign-in names above its buttons, null for a code nobody owns.
export async function referrerOfCode(code: string | null | undefined): Promise<Referrer | null> {
    const owner = await codeOwner(code)
    if (!owner) return null
    return referrerOf(owner.user_id)
}

// Who invited this workspace, while its free month is still to come: the checkout names them.
export async function pendingReferrer(workspaceId: number): Promise<Referrer | null> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'referrals', ['referrer_user_id'] as const, { referee_workspace_id: workspaceId, rewarded_at: { isNull: true } })
    if (!data) return null
    return referrerOf(data.referrer_user_id)
}

// Called once, when the account is born: an account that already existed is never someone's friend.
// Never throws, a referral must not hold back a signup.
export async function attachReferral(refereeUserId: string, refereeWorkspaceId: number, code: string | null | undefined): Promise<void> {
    try {
        const owner = await codeOwner(code)
        if (!owner || owner.user_id === refereeUserId || owner.workspace_id === refereeWorkspaceId) return
        const { error } = await createServiceRoleClient()
            .from('referrals')
            .upsert<Database['public']['Tables']['referrals']['Insert']>(
                { code: owner.code, referrer_workspace_id: owner.workspace_id, referrer_user_id: owner.user_id, referee_user_id: refereeUserId, referee_workspace_id: refereeWorkspaceId },
                { onConflict: 'referee_user_id', ignoreDuplicates: true },
            )
        if (error) console.error('[referral] attach failed', error)
    } catch (err) {
        console.error('[referral] attach failed', err)
    }
}
