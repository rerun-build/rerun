import { ConnectionInputError, startClaudeSignIn } from '@/app/api/_services/ai-connection.service'
import { answeringConnectionErrors } from '@/app/api/v1/_lib/ai-connection-errors'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mintClaudeSignIn } from '@/lib/engine/sign-in-ticket'
import { isLifetimePlan } from '@rerun/cloud/billing'

export const dynamic = 'force-dynamic'

// The PKCE pair stays sealed in the ticket: only this person's finish call can exchange the code.
export const POST = apiRoute({ auth: 'admin' }, async ({ ctx }) =>
    answeringConnectionErrors(async () => {
        if (isLifetimePlan(ctx.workspace)) throw new ConnectionInputError('claudePlanNotOffered')
        const start = startClaudeSignIn()
        return { authorizeUrl: start.authorizeUrl, ticket: mintClaudeSignIn(ctx.userId, start) }
    })
)
