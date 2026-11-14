import { z } from 'zod'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { embedText } from '@/lib/services/embed'

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

    if (!(await authenticateEngineToken(token))) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        return Response.json({ embedding: await embedText(parsed.data.text) })
    } catch (err) {
        console.error('[embed] failed', err)
        return Response.json({ embedding: null })
    }
}
