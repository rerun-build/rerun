import { startGrokSignIn } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors, signInStep } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mintGrokSignIn } from '@/lib/engine/sign-in-ticket'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The device code stays in the ticket, encrypted: only this person's polls, in this workspace, can
// take the approval.
export const POST = apiRoute(mobileApi.startGrokSignIn, { auth: 'admin' }, async ({ ctx }) =>
    answeringConnectionErrors(async () => {
        const start = await signInStep(() => startGrokSignIn(ctx.workspace.id))
        return { ticket: mintGrokSignIn(ctx.userId, ctx.workspace.id, start), userCode: start.userCode, verificationUrl: start.verificationUrl, pollIntervalMs: start.pollIntervalMs, expiresAt: start.expiresAt }
    })
)
