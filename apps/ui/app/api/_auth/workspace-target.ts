import { requireWorkspaceId } from '@/app/api/_auth/ownership'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import type { EngineConnection } from '@/lib/engine/types'

export async function requireWorkspaceConnection(): Promise<EngineConnection> {
    return getWorkspaceConnection(await requireWorkspaceId())
}
