import { MARK_PATH } from '@rerun/ui/logo'
import type { Options, Shape } from 'canvas-confetti'

const DURATION_MS = 2500
const EMIT_INTERVAL_MS = 60
const EMITTERS_PER_TICK = 3
const PARTICLES_PER_EMITTER = 2
const NEUTRALS = ['#ffffff', '#e5e5e5', '#a3a3a3']

let buddyShape: Shape | null = null
let firing = false

// canvas-confetti assigne la couleur par index de particule (`colors[i % colors.length]`),
// donc un tir de 2 particules ne verrait jamais que les 2 premières teintes de la palette.
function rotated(colors: string[]) {
    const offset = Math.floor(Math.random() * colors.length)
    return [...colors.slice(offset), ...colors.slice(0, offset)]
}

function confettiColors() {
    const style = getComputedStyle(document.documentElement)
    return [...NEUTRALS, ...['--brand', '--brand-tint'].map(name => style.getPropertyValue(name).trim())]
}

export async function fireRerunConfetti() {
    if (firing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    firing = true

    // `shapeFromPath` est typé comme export nommé (merge de namespace) mais le build ESM de
    // canvas-confetti ne l'expose que sur le default export : le déstructurer casse au runtime.
    const { default: confetti } = await import('canvas-confetti')

    buddyShape ??= confetti.shapeFromPath({ path: MARK_PATH })

    const baseOptions: Options = {
        shapes: [buddyShape],
        particleCount: PARTICLES_PER_EMITTER,
        angle: 270,
        spread: 55,
        startVelocity: 10,
        gravity: 2.2,
        ticks: 300,
        scalar: 3,
    }

    const colors = confettiColors()
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
            // Origines stratifiées sur la largeur : un x aléatoire partagé par toutes les
            // particules d'un tir les ferait tomber en paquets, avec des trous entre eux.
            for (let slot = 0; slot < EMITTERS_PER_TICK; slot++) {
                void confetti({
                    ...baseOptions,
                    colors: rotated(colors),
                    origin: { x: (slot + Math.random()) / EMITTERS_PER_TICK, y: -0.15 },
                    drift: (Math.random() - 0.5) * 1.5,
                })
            }
        }
        requestAnimationFrame(emit)
    }

    requestAnimationFrame(emit)
}
