import { requireLightSessionActor, type Actor } from '@/app/api/_auth/access'
import { checkAllAgentsHealth } from '@/app/api/_services/gateway.service'

export async function GET(): Promise<Response> {
    let actor: Actor
    try {
        actor = await requireLightSessionActor()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return Response.json(await checkAllAgentsHealth(actor))
}
