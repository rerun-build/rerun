import { accountDeletionBlockers, anonymizeAccount } from '@/app/api/_services/account-deletion.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { ACCOUNT_DELETION_REAUTH_MS, mobileApi, REAUTH_REQUIRED } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// What stands in the way of deleting the account: a workspace only this user holds, still billed.
export const GET = apiRoute(mobileApi.getAccountDeletion, { auth: 'user' }, async ({ ctx }) => ({ blockers: await accountDeletionBlockers(createServiceRoleClient(), ctx.user.id) }))

// Irreversible, so a token alone is not enough: the person signed in minutes ago, or signs in again.
export const DELETE = apiRoute(mobileApi.deleteAccount, { auth: 'user' }, async ({ ctx }) => {
    const signedInAt = ctx.user.last_sign_in_at ? Date.parse(ctx.user.last_sign_in_at) : 0
    if (signedInAt < Date.now() - ACCOUNT_DELETION_REAUTH_MS) return Response.json({ ...refusal('signInAgainToDeleteAccount'), reason: REAUTH_REQUIRED }, { status: 403 })

    const result = await anonymizeAccount(createServiceRoleClient(), ctx.user.id)
    if (result.ok) return undefined
    return Response.json({ ...refusal('cancelSubscriptionsFirst', { names: result.blockers.map(blocker => blocker.name).join(', ') }), blockers: result.blockers }, { status: 409 })
})
