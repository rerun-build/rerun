import { assertAgentInWorkspace } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { getCustomMcpStatuses } from '@/app/api/_services/custom-mcp.service'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params
    try {
        await assertAgentInWorkspace(id)
    } catch (err) {
        return err instanceof AuthorizationError ? Response.json({ error: err.message }, { status: 404 }) : Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    try {
        return Response.json({ servers: await getCustomMcpStatuses(id) })
    } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Engine unreachable' }, { status: 502 })
    }
}
