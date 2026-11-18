import { z } from 'zod'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { embedTextShared } from '@/lib/services/embed'

const bodySchema = z.object({ text: z.string().min(1) })

export async function POST(req: Request) {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const engine = await authenticateEngineToken(token)
    if (!engine) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // A memory stored without its vector is still found by keyword; a 500 would only lose the reason.
    try {
        return Response.json({ embedding: await embedTextShared(engine.workspaceId, parsed.data.text) })
    } catch (err) {
        console.error('[embed] failed', err)
        return Response.json({ embedding: null })
    }
}
