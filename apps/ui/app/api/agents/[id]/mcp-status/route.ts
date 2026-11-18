import { AuthorizationError } from '@/app/api/_auth/ownership'
import { getCustomMcpStatuses } from '@/app/api/_services/custom-mcp.service'

export const dynamic = 'force-dynamic'

// Each custom server is dialed for real, up to fifteen seconds. A route rather than a server action
// for the same reason as the health poll: actions from one page queue behind each other.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params
    try {
        return Response.json({ servers: await getCustomMcpStatuses(id) })
    } catch (err) {
        if (err instanceof AuthorizationError) return Response.json({ error: err.message }, { status: 404 })
        return Response.json({ error: err instanceof Error ? err.message : 'Engine unreachable' }, { status: 502 })
    }
}
