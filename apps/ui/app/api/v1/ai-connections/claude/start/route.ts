import { startClaudeSignIn } from '@/app/api/_services/ai-connection.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mintClaudeSignIn } from '@/lib/engine/sign-in-ticket'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'admin' }, async ({ ctx }) => {
    const start = startClaudeSignIn()
    return { authorizeUrl: start.authorizeUrl, ticket: mintClaudeSignIn(ctx.userId, start) }
})
