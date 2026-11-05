import 'server-only'

import { ensureWorkspaceEngine, findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { RERUN_CLOUD } from '@/cloud/edition'
import type { ForemanState } from './phase'
import { foremanSurface, type ForemanSurface } from './surface'

// `canClaim` is false for an anonymous visitor: their workspace is thrown away with them, so it must
// never be the one the compose engine lands on.
export async function resolveForemanSurface(workspaceId: number, state: Pick<ForemanState, 'phase'>, { canClaim }: { canClaim: boolean }): Promise<ForemanSurface> {
    if (state.phase !== 'companion') return 'onboarding'
    return foremanSurface(state.phase, await hasEngine(workspaceId, canClaim))
}

// A self-hosted install hands its compose engine to the first thing that needs one, and a workspace
// that skipped the onboarding has nothing else to claim it: the foreman is that first thing.
async function hasEngine(workspaceId: number, canClaim: boolean): Promise<boolean> {
    if (await findWorkspaceEngine(workspaceId)) return true
    if (RERUN_CLOUD || !canClaim) return false
    const claimed = await ensureWorkspaceEngine(workspaceId).catch(err => {
        console.error(`[foreman] failed to claim the compose engine for workspace ${workspaceId}`, err)
        return null
    })
    return !!claimed?.ok
}
