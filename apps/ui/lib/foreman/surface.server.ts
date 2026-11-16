import 'server-only'

import { ensureWorkspaceEngine, findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { onboardingReleasedAt } from '@/lib/onboarding/facts'
import { isLegacyWorkspace } from '@/lib/onboarding/step'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import type { ForemanState } from './phase'
import { foremanSurface, type ForemanSurface } from './surface'

type SurfaceState = Pick<ForemanState, 'phase'> & Partial<Pick<ForemanState, 'foreman' | 'onboardingCompletedAt' | 'workspaceCreatedAt'>>

// A workspace of the onboarding dialog talks to the Chief of Staff on its box, once the dialog has
// claimed one. The others keep the hub's onboarding.
function walksTheDialog(state: SurfaceState): boolean {
    if (!state.foreman) return false
    return !isLegacyWorkspace({ createdAt: state.workspaceCreatedAt ?? null, onboardedAt: state.onboardingCompletedAt ?? null, foreman: state.foreman }, onboardingReleasedAt())
}

// `canClaim` is false for an anonymous visitor: their workspace is thrown away with them, so it must
// never be the one the compose engine lands on.
export async function resolveForemanSurface(workspaceId: number, state: SurfaceState, { canClaim }: { canClaim: boolean }): Promise<ForemanSurface> {
    if (walksTheDialog(state)) return (await findWorkspaceEngine(workspaceId)) ? 'engine' : 'none'
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
