import { assertAgentInWorkspace } from '@/app/api/_auth/access'
import { AuthorizationError } from '@/app/api/_auth/ownership'
import { getMcpSessionStates, reconnectMcpSession } from '@/app/api/_services/custom-mcp.service'

export const dynamic = 'force-dynamic'

async function guard(id: string): Promise<Response | null> {
    try {
        await assertAgentInWorkspace(id)
        return null
    } catch (err) {
        return err instanceof AuthorizationError ? Response.json({ error: err.message }, { status: 404 }) : Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
}

const unreachable = (err: unknown): Response => Response.json({ error: err instanceof Error ? err.message : 'Engine unreachable' }, { status: 502 })

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params
    const denied = await guard(id)
    if (denied) return denied
    try {
        return Response.json({ servers: await getMcpSessionStates(id) })
    } catch (err) {
        return unreachable(err)
    }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params
    const denied = await guard(id)
    if (denied) return denied
    const body: unknown = await req.json().catch(() => null)
    const name = body && typeof body === 'object' ? (body as { name?: unknown }).name : undefined
    if (typeof name !== 'string' || name === '') return Response.json({ error: 'name is required' }, { status: 400 })
    try {
        return Response.json(await reconnectMcpSession(id, name))
    } catch (err) {
        return unreachable(err)
    }
}
