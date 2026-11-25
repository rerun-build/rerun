import { engineBrandOf } from '@rerun/contracts'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { workspaceBrand } from '@/lib/brand/workspace'

// The brand a machine runs under, asked with its engine key, which names the workspace.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
    const header = req.headers.get('authorization') ?? ''
    const engine = await authenticateEngineToken(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (!engine) return new Response('Unauthorized', { status: 401 })
    return Response.json(engineBrandOf(await workspaceBrand(engine.workspaceId)))
}
