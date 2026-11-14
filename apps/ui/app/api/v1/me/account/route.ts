import { accountDeletionBlockers, anonymizeAccount } from '@/app/api/_services/account-deletion.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { ACCOUNT_DELETION_REAUTH_MS, deleteAccountRequestSchema, REAUTH_REQUIRED } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'user' }, async ({ ctx }) => ({ blockers: await accountDeletionBlockers(createServiceRoleClient(), ctx.user.id) }))

export const DELETE = apiRoute({ auth: 'user', body: deleteAccountRequestSchema }, async ({ ctx }) => {
    const signedInAt = ctx.user.last_sign_in_at ? Date.parse(ctx.user.last_sign_in_at) : 0
    if (signedInAt < Date.now() - ACCOUNT_DELETION_REAUTH_MS) return Response.json({ error: 'Sign in again to delete your account.', reason: REAUTH_REQUIRED }, { status: 403 })

    const result = await anonymizeAccount(createServiceRoleClient(), ctx.user.id)
    if (result.ok) return undefined
    return Response.json({ error: `Cancel the subscription of ${result.blockers.map(blocker => blocker.name).join(', ')} first.`, blockers: result.blockers }, { status: 409 })
})
