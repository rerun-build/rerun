'use client'

import { GrainGradient } from '@paper-design/shaders-react'
import { useReducedMotion } from 'motion/react'
import { useState } from 'react'

// Paper draws at twice the screen's density even on a 1x screen, up to 8 million pixels a frame: a
// soft grain needs neither. The screen's own density, capped at a 1440p panel, is enough.
const MAX_PIXELS = 2560 * 1440

const drawsWebGl = () => document.createElement('canvas').getContext('webgl2') !== null

// A grain gradient in the brand's indigo, written in hex because a shader reads no CSS variable. It
// pauses on its own in a hidden tab, stands still for reduced motion, and leaves the panel's flat
// color where there is no WebGL.
export function PanelGround() {
    const still = useReducedMotion()
    const [drawn] = useState(drawsWebGl)
    if (!drawn) return null
    return (
        <GrainGradient
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            colorBack="#0c0a1f"
            colors={['#4d34f7', '#7a68ff', '#24188f']}
            shape="corners"
            softness={0.75}
            intensity={0.2}
            noise={0.3}
            speed={still ? 0 : 0.6}
            minPixelRatio={1}
            maxPixelCount={MAX_PIXELS}
        />
    )
}
