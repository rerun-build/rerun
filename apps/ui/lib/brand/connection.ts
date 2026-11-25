import type { EngineConnection } from '@/lib/engine/types'
import { FEATURE_REQUESTS_ENABLED } from '@rerun/cloud/feature-requests'
import { isWhiteLabel, RERUN_BRAND, type Brand } from '@rerun/contracts'
import { workspaceBrand } from './workspace'

// The brand a machine runs under.
export async function connectionBrand({ workspaceId }: EngineConnection): Promise<Brand> {
    return workspaceId === undefined ? RERUN_BRAND : workspaceBrand(workspaceId)
}

// A request to the Rerun team is offered to Rerun's own workspaces, never to an organization's clients.
export async function offersTeamRequests(conn: EngineConnection): Promise<boolean> {
    return FEATURE_REQUESTS_ENABLED && !isWhiteLabel(await connectionBrand(conn))
}
