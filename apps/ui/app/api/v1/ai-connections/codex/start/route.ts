import { startCodexSignIn } from '@/app/api/_services/ai-connection.service'
import { signInStep } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mintCodexSignIn } from '@/lib/engine/sign-in-ticket'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The device auth id stays sealed in the ticket: only this person's polls can take the approval.
export const POST = apiRoute(mobileApi.startCodexSignIn, { auth: 'admin' }, async ({ ctx }) => {
    const start = await signInStep(() => startCodexSignIn())
    return { ticket: mintCodexSignIn(ctx.userId, start), userCode: start.userCode, verificationUrl: start.verificationUrl, pollIntervalMs: start.pollIntervalMs, expiresAt: start.expiresAt }
})
