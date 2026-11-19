import type { ForemanSurface } from '@moldwright/contracts'

import type { ForemanPhase } from './phase'

export type { ForemanSurface }

export function foremanSurface(phase: ForemanPhase, hasEngine: boolean): ForemanSurface {
    if (phase !== 'companion') return 'onboarding'
    return hasEngine ? 'engine' : 'none'
}
