import { requireLightSessionActor, type Actor } from '@/app/api/_auth/access'
import { listWorkspaceSchedules } from '@/app/api/_services/workspace-schedules.service'

export async function GET(): Promise<Response> {
    let actor: Actor
    try {
        actor = await requireLightSessionActor()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json(await listWorkspaceSchedules(actor))
}
