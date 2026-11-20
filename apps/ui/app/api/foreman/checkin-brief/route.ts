import { checkinBriefRequestSchema } from '@rerun/contracts'

import { authenticateEngineToken, getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import { supportsForemanVault } from '@/lib/engine/client'
import { founderContext } from '@/lib/foreman/checkin-context'
import { foremanCheckinBrief } from '@/lib/foreman/engine-brief'
import { mintForemanHubToken } from '@/lib/foreman/hub-token'
import { loadForemanState } from '@/lib/foreman/state'

// The box asks for the brief of a check-in of its Chief of Staff, with its engine key, which names the
// workspace. The token it gets back opens only the hub tools that read, for an hour.
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
    const header = req.headers.get('authorization') ?? ''
    const engine = await authenticateEngineToken(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (!engine) return new Response('Unauthorized', { status: 401 })

    const parsed = checkinBriefRequestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

    const ctx = await founderContext(engine.workspaceId)
    if (!ctx) return Response.json({ error: 'This workspace has no member to read it for.' }, { status: 404 })
    const state = await loadForemanState(ctx, null)
    const hubToken = mintForemanHubToken(engine.workspaceId, null, Date.now(), 'read')
    const vault = await getWorkspaceConnection(engine.workspaceId)
        .then(supportsForemanVault)
        .catch(() => false)
    return Response.json({ ...foremanCheckinBrief(state, parsed.data.reason, { vault }), ...(hubToken ? { hubToken } : {}) })
}
