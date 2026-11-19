import { codexKeysWhenApproved, storeSignInKeys } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors, signInStep } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { openCodexSignIn } from '@/lib/engine/sign-in-ticket'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The app polls this until the user has typed the code on OpenAI's page; the approval is stored the
// moment it lands, so the tokens never reach the phone.
export const POST = apiRoute(mobileApi.pollCodexSignIn, { auth: 'admin' }, async ({ ctx, body }) => {
    const keys = await signInStep(async () => {
        const { deviceAuthId, userCode } = openCodexSignIn(body.ticket, ctx.userId)
        return codexKeysWhenApproved(deviceAuthId, userCode)
    })
    if (!keys) return { status: 'pending' as const }
    return answeringConnectionErrors(async () => ({ status: 'connected', connectionId: await storeSignInKeys(ctx.workspace.id, 'codex', keys, body) }))
})
