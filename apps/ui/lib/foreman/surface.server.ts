import 'server-only'

import { ensureWorkspaceEngine, findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import type { ForemanState } from './phase'
import { foremanSurface, type ForemanSurface } from './surface'

export async function resolveForemanSurface(workspaceId: number, state: Pick<ForemanState, 'phase'>, { canClaim }: { canClaim: boolean }): Promise<ForemanSurface> {
    if (state.phase !== 'companion') return 'onboarding'
    return foremanSurface(state.phase, await hasEngine(workspaceId, canClaim))
}

async function hasEngine(workspaceId: number, canClaim: boolean): Promise<boolean> {
    if (await findWorkspaceEngine(workspaceId)) return true
    if (RERUN_CLOUD || !canClaim) return false
    const claimed = await ensureWorkspaceEngine(workspaceId).catch(err => {
        console.error(`[foreman] failed to claim the compose engine for workspace ${workspaceId}`, err)
        return null
    })
    return !!claimed?.ok
}
