import { actorFromContext } from '@/app/api/_auth/access'
import { getCustomMcpServer } from '@/app/api/_services/custom-mcp.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import type { McpServerView } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx, params }): Promise<McpServerView> => {
    const found = await getCustomMcpServer(params.id, params.name, actorFromContext(ctx))
    if (!found) throw new ApiError(404, `MCP server not found: ${params.name}`)
    const { server, status } = found
    return { name: server.name, displayName: server.displayName, host: server.host, icon: server.icon, status, canSignIn: server.signInUrl !== null }
})
