'use client'

import { useState } from 'react'

// Which way a step slides, told from how deep the view is: going deeper slides in from the right,
// coming back out from the left, so a three-level view comes back out the way it went in.
export function useStepDirection(depth: number) {
    const [previousDepth, setPreviousDepth] = useState(depth)
    const [direction, setDirection] = useState(1)

    if (previousDepth !== depth) {
        setPreviousDepth(depth)
        setDirection(depth < previousDepth ? -1 : 1)
    }

    return direction
}
