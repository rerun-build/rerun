import { R_PATH } from '@moldwright/ui/logo'
import type { Options, Shape } from 'canvas-confetti'

const DURATION_MS = 2500
const EMIT_INTERVAL_MS = 60
const EMITTERS_PER_TICK = 3
const PARTICLES_PER_EMITTER = 2
const COLORS = ['#ffffff', '#e5e5e5', '#a3a3a3', '#4d34f7', '#b7a8ff']

let rShape: Shape | null = null
let firing = false

function rotatedColors() {
    const offset = Math.floor(Math.random() * COLORS.length)
    return [...COLORS.slice(offset), ...COLORS.slice(0, offset)]
}

export async function fireMoldwrightConfetti() {
    if (firing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    firing = true

    const { default: confetti } = await import('canvas-confetti')

    rShape ??= confetti.shapeFromPath({ path: R_PATH })

    const baseOptions: Options = {
        shapes: [rShape],
        particleCount: PARTICLES_PER_EMITTER,
        angle: 270,
        spread: 55,
        startVelocity: 10,
        gravity: 2.2,
        ticks: 300,
        scalar: 3,
    }

    const start = performance.now()
    let lastEmit = -Infinity

    const emit = (now: number) => {
        const elapsed = now - start
        if (elapsed > DURATION_MS) {
            firing = false
            return
        }
        if (elapsed - lastEmit >= EMIT_INTERVAL_MS) {
            lastEmit = elapsed
            for (let slot = 0; slot < EMITTERS_PER_TICK; slot++) {
                void confetti({
                    ...baseOptions,
                    colors: rotatedColors(),
                    origin: { x: (slot + Math.random()) / EMITTERS_PER_TICK, y: -0.15 },
                    drift: (Math.random() - 0.5) * 1.5,
                })
            }
        }
        requestAnimationFrame(emit)
    }

    requestAnimationFrame(emit)
}
