import { claudeKeysFromCode, storeSignInKeys } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors, signInStep } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { openClaudeSignIn } from '@/lib/engine/sign-in-ticket'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute(mobileApi.finishClaudeSignIn, { auth: 'admin' }, async ({ ctx, body }) => {
    const keys = await signInStep(async () => {
        const { verifier, state } = openClaudeSignIn(body.ticket, ctx.userId)
        return claudeKeysFromCode(body.code, verifier, state)
    })
    return answeringConnectionErrors(async () => ({ connectionId: await storeSignInKeys(ctx.workspace.id, 'claude', keys, body) }))
})
