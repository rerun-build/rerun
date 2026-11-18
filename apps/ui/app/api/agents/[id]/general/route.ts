import { assertAgentAccess } from '@/app/api/_auth/access'
import { UnauthenticatedError } from '@/app/api/_auth/ownership'
import { findGeneralSession } from '@/app/api/_services/chat.service'

export const dynamic = 'force-dynamic'

// The coworker's General, null until someone has spoken in it. Read through the caller's own access
// to the coworker, like every other read of its conversations, and by a route rather than a server
// action: it is the first thing an opening chat asks, and actions queue behind each other.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params
    try {
        await assertAgentAccess(id, 'use')
    } catch (err) {
        if (err instanceof UnauthenticatedError) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return Response.json({ general: await findGeneralSession(id).catch(() => null) })
}
