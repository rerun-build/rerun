'use client'

import { StepTransition, useStepDirection } from '@rerun/ui/steps'
import type { ReactNode } from 'react'

// Drilling into a detail inside a side panel: the step slides in the direction of travel, `depth`
// telling forward from backward.
export function PanelSteps({ stepKey, depth, children }: { stepKey: string; depth: number; children: ReactNode }) {
    const direction = useStepDirection(depth)

    return (
        <StepTransition stepKey={stepKey} direction={direction} className="flex min-h-0 flex-1 flex-col">
            {children}
        </StepTransition>
    )
}
