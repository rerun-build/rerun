import { actorFromContext } from '@/app/api/_auth/access'
import { getCustomMcpServer } from '@/app/api/_services/custom-mcp.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import type { McpServerView } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The server a coworker asks to be signed in to. Read again on every call: the coworker registers it
// moments before asking.
export const GET = apiRoute({ auth: 'member' }, async ({ ctx, params }): Promise<McpServerView> => {
    const found = await getCustomMcpServer(params.id, params.name, actorFromContext(ctx))
    if (!found) throw new ApiError(404, refusal('mcpServerNotFound', { name: params.name }))
    const { server, status } = found
    return { name: server.name, displayName: server.displayName, host: server.host, icon: server.icon, status, canSignIn: server.signInUrl !== null }
})
