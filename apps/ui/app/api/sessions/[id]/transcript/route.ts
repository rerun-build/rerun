import { UnauthenticatedError } from '@/app/api/_auth/ownership'
import { readSessionMessages } from '@/app/api/_services/conversation.service'

export const dynamic = 'force-dynamic'

// The transcript alone, read again when the conversation on screen may have moved without this tab.
// A route rather than a server action, like the snapshot: actions from one page queue behind each other.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
    const { id } = await params
    try {
        return Response.json(await readSessionMessages(id))
    } catch (err) {
        if (err instanceof UnauthenticatedError) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        return Response.json([])
    }
}
