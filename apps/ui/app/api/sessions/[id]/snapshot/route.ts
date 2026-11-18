import { UnauthenticatedError } from '@/app/api/_auth/ownership'
import { readSessionSnapshot } from '@/app/api/_services/conversation.service'
import { EMPTY_SESSION_SNAPSHOT } from '@/lib/chat/session-snapshot'

export const dynamic = 'force-dynamic'

// What a reopened conversation shows. A route rather than a server action for the same reason as
// the health poll: actions from one page queue behind each other, and the transcript is what the
// person is waiting for. Outside /api/v1 on purpose, so the middleware keeps refreshing the session
// it reads.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params
    try {
        return Response.json(await readSessionSnapshot(id))
    } catch (err) {
        if (err instanceof UnauthenticatedError) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        // Out of the caller's reach, or its machine not answering: the conversation opens empty.
        return Response.json(EMPTY_SESSION_SNAPSHOT)
    }
}
