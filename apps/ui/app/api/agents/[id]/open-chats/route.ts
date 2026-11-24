import { UnauthenticatedError } from '@/app/api/_auth/ownership'
import { AuthorizationError } from '@/app/api/_auth/errors'
import { changeOpenChats, readOpenChats } from '@/app/api/_services/open-chats.service'
import { changeOpenChatsSchema, type OpenChats } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

type Segment = { params: Promise<{ id: string }> }

async function answer(run: () => Promise<OpenChats>): Promise<Response> {
    try {
        return Response.json(await run())
    } catch (err) {
        if (err instanceof UnauthenticatedError) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        if (err instanceof AuthorizationError) return Response.json({ error: 'Not found' }, { status: 404 })
        throw err
    }
}

// Routes rather than server actions: the chat asks as it opens, and actions queue behind each other.
export async function GET(_req: Request, { params }: Segment): Promise<Response> {
    const { id } = await params
    return answer(() => readOpenChats(id))
}

export async function POST(req: Request, { params }: Segment): Promise<Response> {
    const { id } = await params
    const body = changeOpenChatsSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return Response.json({ error: 'Invalid body' }, { status: 400 })
    return answer(() => changeOpenChats(id, body.data))
}
