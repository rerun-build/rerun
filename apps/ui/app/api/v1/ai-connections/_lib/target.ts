import { listAiConnections } from '@/app/api/_services/ai-connection.service'
import { ApiError } from '@/app/api/v1/_lib/api-route'
import type { BoxConnection } from '@/lib/engine/types'

export async function connectionTarget(workspaceId: number, id: string): Promise<BoxConnection> {
    const target = (await listAiConnections(workspaceId)).connections.find(connection => connection.id === id)
    if (!target) throw new ApiError(404, 'This provider is not on the machine anymore.')
    return target
}
