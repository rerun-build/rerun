import type { EngineConnection } from '@/lib/engine/types'
import { FEATURE_REQUESTS_ENABLED } from '@rerun/cloud/feature-requests'
import { isWhiteLabel, RERUN_BRAND, type Brand } from '@rerun/contracts'
import { workspaceBrand } from './workspace'

// The brand a machine runs under.
export async function connectionBrand({ workspaceId }: EngineConnection): Promise<Brand> {
    return workspaceId === undefined ? RERUN_BRAND : workspaceBrand(workspaceId)
}

// A request to the Rerun team is offered to Rerun's own workspaces, never to an organization's clients.
// Every turn of every chat asks: a brand that could not be read offers none, and the turn goes on.
export async function offersTeamRequests(conn: EngineConnection): Promise<boolean> {
    if (!FEATURE_REQUESTS_ENABLED) return false
    try {
        return !isWhiteLabel(await connectionBrand(conn))
    } catch (err) {
        console.error('[brand] could not read the brand of a chat turn', err)
        return false
    }
}
