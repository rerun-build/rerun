import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { listAiConnectionsWithOffers } from '@/app/api/_services/ai-connection.service'

export const dynamic = 'force-dynamic'

// The AI providers panel's list with today's plan usage: the engine waits (5 s at most) for the
// readings it starts. A route rather than a Server Action, because a tab runs its actions one after
// the other and every click in the panel would wait behind this read.
export async function GET() {
    let workspaceId: number
    try {
        workspaceId = await requireWorkspaceId()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    try {
        return Response.json(await listAiConnectionsWithOffers(workspaceId, { fresh: true }), { headers: { 'Cache-Control': 'no-store' } })
    } catch {
        return Response.json({ error: 'Engine unreachable' }, { status: 502 })
    }
}
