import { recordGettingStartedEvent } from '@/app/api/_services/getting-started.service'
import { followAuthorOfCreatedTask } from '@/app/api/_services/notification-audience.service'
import { recordNotification } from '@/app/api/_services/notification.service'
import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { engineCreatedEventSchema, engineVaultSignedOutSchema, notificationPayloadSchema } from '@/lib/engine/types'

export async function POST(req: Request) {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const engine = await authenticateEngineToken(token)
    if (!engine) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const created = engineCreatedEventSchema.safeParse(body)
    if (created.success) {
        await Promise.all([recordGettingStartedEvent(engine.workspaceId, created.data.event), followAuthorOfCreatedTask(engine.workspaceId, created.data)])
        return Response.json({ ok: true }, { status: 202 })
    }

    if (engineVaultSignedOutSchema.safeParse(body).success) return Response.json({ ok: true }, { status: 202 })

    const parsed = notificationPayloadSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })

    const result = await recordNotification(token, parsed.data)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

    return Response.json({ ok: true }, { status: 202 })
}
