import { listAiConnections } from '@/app/api/_services/ai-connection.service'
import { ApiError } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import type { BoxConnection } from '@/lib/engine/types'

// The id in the path is only ever one the machine lists: it lands in a path to the engine, and the
// listing is what says it is a connection of this workspace and not another route.
export async function connectionTarget(workspaceId: number, id: string): Promise<BoxConnection> {
    const target = (await listAiConnections(workspaceId)).connections.find(connection => connection.id === id)
    if (!target) throw new ApiError(404, refusal('providerGoneFromMachine'))
    return target
}
