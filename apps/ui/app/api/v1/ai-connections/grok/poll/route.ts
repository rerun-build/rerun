import { grokKeysWhenApproved, storeGrokSignIn } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors, signInStep } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { openGrokSignIn } from '@/lib/engine/sign-in-ticket'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The app polls this until the person has approved on xAI's page; the approval is stored the moment
// it lands, so the tokens never reach the phone.
export const POST = apiRoute(mobileApi.pollGrokSignIn, { auth: 'admin' }, async ({ ctx, body }) => {
    const keys = await signInStep(async () => {
        const { deviceCode } = openGrokSignIn(body.ticket, ctx.userId, ctx.workspace.id)
        return grokKeysWhenApproved(deviceCode)
    })
    if (!keys) return { status: 'pending' as const }
    return answeringConnectionErrors(async () => ({ status: 'connected' as const, connectionId: await storeGrokSignIn(ctx.workspace.id, keys, body) }))
})
