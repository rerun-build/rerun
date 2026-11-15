'use client'

import { StepTransition } from '@rerun/ui/steps'
import { useState, type ReactNode } from 'react'

export function PanelSteps({ stepKey, depth, children }: { stepKey: string; depth: number; children: ReactNode }) {
    const [previousDepth, setPreviousDepth] = useState(depth)
    const [direction, setDirection] = useState(1)

    if (previousDepth !== depth) {
        setPreviousDepth(depth)
        setDirection(depth < previousDepth ? -1 : 1)
    }

    return (
        <StepTransition stepKey={stepKey} direction={direction} className="flex min-h-0 flex-1 flex-col">
            {children}
        </StepTransition>
    )
}
