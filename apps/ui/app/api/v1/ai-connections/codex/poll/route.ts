import { codexKeysWhenApproved, storeSignInKeys } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors, signInStep } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { openCodexSignIn } from '@/lib/engine/sign-in-ticket'
import { codexSignInPollInputSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'admin', body: codexSignInPollInputSchema }, async ({ ctx, body }) => {
    const keys = await signInStep(async () => {
        const { deviceAuthId, userCode } = openCodexSignIn(body.ticket, ctx.userId)
        return codexKeysWhenApproved(deviceAuthId, userCode)
    })
    if (!keys) return { status: 'pending' }
    return answeringConnectionErrors(async () => ({ status: 'connected', connectionId: await storeSignInKeys(ctx.workspace.id, 'codex', keys, body) }))
})
