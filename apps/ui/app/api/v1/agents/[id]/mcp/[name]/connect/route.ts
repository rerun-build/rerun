import { actorFromContext, assertAgentInWorkspace } from '@/app/api/_auth/access'
import { getCustomMcpServer } from '@/app/api/_services/custom-mcp.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { mcpConnectUrl, requestingDesktop } from '@/app/api/v1/_lib/service-view'
import { appReturnBase } from '@/lib/oauth/app-return'
import type { ConnectTarget } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// Mints the ticket the in-app browser opens the server's sign-in with.
export const POST = apiRoute({ auth: 'member' }, async ({ req, ctx, params }): Promise<ConnectTarget> => {
    const actor = actorFromContext(ctx)
    await assertAgentInWorkspace(params.id, 'manage', actor)
    const found = await getCustomMcpServer(params.id, params.name, actor)
    if (!found) throw new ApiError(404, `MCP server not found: ${params.name}`)
    if (!found.server.signInUrl) throw new ApiError(409, `${found.server.displayName} has no sign-in to open from here.`)
    return { url: mcpConnectUrl(req, ctx, params.id, params.name), returnUrl: appReturnBase(requestingDesktop(req)) }
})
