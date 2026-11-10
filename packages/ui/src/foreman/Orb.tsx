'use client'

import { useAnimationFrame, useReducedMotion } from 'motion/react'
import { type RefObject, useMemo, useRef, useState } from 'react'

import { cn } from '../cn'
import { useOnScreen } from '../iso-grid/hooks/useOnScreen'

import { FOREMAN_BALL_FRAME, ForemanBall, foremanFacePose, foremanFaceRest } from './ForemanBall'
import type { ForemanFacing } from './foreman-face'
import { ORB_TUNING, approachTuning, type OrbTuning } from './orb-tuning'
import { useKitTranslations } from '../locale'

export type OrbActivity = 'idle' | 'listening' | 'thinking' | 'speaking'

// How far the eyes go, in the face's own units: enough to read a direction, never enough to leave
// the plate they sit on.
const LOOK_X = 3.6
const LOOK_Y = 2.2
const WANDER = 0.5

const DEGREES = Math.PI / 180
// Jusqu'où la boule se tourne vers ce qu'elle regarde.
const TURN_TO_X = 42 * DEGREES
const TURN_TO_Y = 24 * DEGREES
const NOD_RATE = 7
// En réflexion la boule fait un tour complet sur elle-même, à l'entrée dans l'état puis de loin en loin.
const SPIN_SECONDS = 0.7
const SPIN_EVERY = 5

function easeInOut(progress: number) {
    return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2
}

/** Où la bille regarde : une direction normalisée autour de son centre, -1…1 sur chaque axe. */
export type OrbGaze = { x: number; y: number }

export type OrbProps = {
    state?: OrbActivity
    /** Le diamètre de la boule : son ombre et son rebond débordent de cette boîte. */
    size: number
    onClick?: () => void
    label?: string
    /** Fige la boule. Deux orbes coexistent le temps d'un fondu, une seule doit bouger. */
    paused?: boolean
    /**
     * Ce que la bille regarde, lu à chaque frame : une ref plutôt qu'une valeur, pour suivre un
     * pointeur sans re-render. `null` rend le regard à sa dérive habituelle.
     */
    gaze?: RefObject<OrbGaze | null>
    /** Vers où la bille est tournée au repos : vers ce qu'elle accompagne. */
    facing?: ForemanFacing
    className?: string
}

/**
 * Le Foreman : une boule de verre indigo, deux yeux ronds sur une plaque sombre. Les quatre états ne
 * changent jamais la forme ni la matière, seulement le rythme du rebond, du reflet et du regard.
 */
export function Orb({ state = 'idle', size, onClick, label, paused = false, gaze, facing = 'left', className }: OrbProps) {
    const t = useKitTranslations()
    const reducedMotion = useReducedMotion()
    const rest = foremanFaceRest(facing)
    // Un état et non un `useRef` : la racine passe de `button` à `span` quand `onClick` tombe (le
    // dock, une fois ouvert), React remonte tout le sous-arbre, et l'observer de `useOnScreen` resterait
    // sur l'ancien span détaché. Un nouvel objet ref par élément relance son effet.
    const [ball, setBall] = useState<HTMLSpanElement | null>(null)
    const ballRef = useMemo(() => ({ current: ball }), [ball])
    const eyesRef = useRef<SVGGElement>(null)
    const tuningRef = useRef<OrbTuning>({ ...ORB_TUNING[state] })
    const faceRef = useRef<SVGGElement>(null)
    const clockRef = useRef({ gaze: 0, lookX: 0, lookY: 0, turn: 0, nod: 0, yaw: rest.yaw, pitch: rest.pitch, spin: 1, spinSide: 1, nextSpin: 0, atRest: true })
    // Hors de l'écran, personne ne voit son regard dériver : la boucle cesse d'écrire. Elle tournait
    // jusqu'ici tant que la page vivait — deux `transform` de SVG par image, à six écrans de là.
    const onScreen = useOnScreen(ballRef)
    const still = reducedMotion || paused || !onScreen

    // Rien ne passe par un re-render : la boucle n'écrit qu'un `transform` sur les yeux et le visage.
    useAnimationFrame((_, deltaMs) => {
        if (still) {
            // Une boule figée en plein tour resterait sans visage.
            if (!clockRef.current.atRest) {
                faceRef.current?.setAttribute('transform', foremanFacePose(rest.yaw, rest.pitch))
                clockRef.current.atRest = true
            }
            return
        }
        const dt = Math.min(deltaMs / 1000, 0.05)
        const tuning = tuningRef.current
        const clock = clockRef.current
        approachTuning(tuning, ORB_TUNING[state], dt)
        clock.gaze += dt * tuning.gazeRate

        // Le regard balaie deux sinusoïdes incommensurables : une seule ferait un va-et-vient de
        // métronome, et c'est ce qui trahit tout de suite une boucle.
        const wander = (Math.sin(clock.gaze * 1.7) * 0.6 + Math.sin(clock.gaze * 4.3 + 1.1) * 0.4) * WANDER * tuning.gaze
        const lift = (Math.sin(clock.gaze * 1.1 + 2.3) * 0.5 + Math.sin(clock.gaze * 3.1) * 0.3) * WANDER * tuning.gaze * 0.55

        // Un regard posé sur quelque chose garde un reste de dérive, sinon les yeux se figent comme
        // ceux d'une poupée ; il y va et en revient en douceur plutôt que d'y sauter.
        const target = gaze?.current ?? null
        const ease = 1 - Math.exp(-dt * 9)
        clock.lookX += ((target ? target.x * LOOK_X : 0) - clock.lookX) * ease
        clock.lookY += ((target ? target.y * LOOK_Y : 0) - clock.lookY) * ease
        const drift = target ? 0.3 : 1
        eyesRef.current?.setAttribute('transform', `translate(${(wander * drift + clock.lookX).toFixed(3)} ${(lift * drift + clock.lookY).toFixed(3)})`)

        // La tête suit les yeux avec un temps de retard : c'est la boule entière qui pivote, les
        // reflets ne bougent pas, et c'est ce qui la fait lire comme une sphère.
        clock.turn += dt * tuning.turnRate
        clock.nod += dt * NOD_RATE
        const headEase = 1 - Math.exp(-dt * 6)
        clock.yaw += ((target ? target.x * TURN_TO_X : rest.yaw) - clock.yaw) * headEase
        clock.pitch += ((target ? -target.y * TURN_TO_Y : rest.pitch) - clock.pitch) * headEase
        const sweep = (Math.sin(clock.turn * 1.3) * 0.65 + Math.sin(clock.turn * 2.9 + 0.7) * 0.35) * tuning.turn * DEGREES
        const tilt = (Math.sin(clock.turn * 0.9 + 1.9) * 0.6 + Math.sin(clock.turn * 2.3) * 0.4) * tuning.turn * 0.38 * DEGREES

        if (state === 'thinking') {
            clock.nextSpin -= dt
            if (clock.nextSpin <= 0 && clock.spin >= 1) {
                clock.spin = 0
                clock.spinSide = -clock.spinSide
                clock.nextSpin = SPIN_EVERY * (0.8 + Math.random() * 0.4)
            }
        } else {
            clock.nextSpin = 0
        }
        clock.spin = Math.min(1, clock.spin + dt / SPIN_SECONDS)
        const spin = clock.spin < 1 ? easeInOut(clock.spin) * 2 * Math.PI * clock.spinSide : 0

        const yaw = clock.yaw + sweep * drift + spin
        const pitch = clock.pitch + tilt * drift + Math.sin(clock.nod) * tuning.nod * DEGREES
        faceRef.current?.setAttribute('transform', foremanFacePose(yaw, pitch))
        clock.atRest = false
    })

    const Root = onClick ? 'button' : 'span'
    const inset = -size * FOREMAN_BALL_FRAME.inset

    return (
        <Root
            {...(onClick ? { type: 'button' as const, 'aria-label': label ?? t('foreman.orbLabel'), onClick } : { 'aria-hidden': true })}
            className={cn(
                'relative block rounded-full',
                onClick && 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                className
            )}
            style={{ width: size, height: size }}
        >
            <span ref={setBall} className="pointer-events-none absolute flex" style={{ left: inset, top: inset }}>
                <ForemanBall material="glass" face="plate" eyes="round" scale={FOREMAN_BALL_FRAME.scale} size={size} state={state} animated={!paused} facing={facing} eyesRef={eyesRef} faceRef={faceRef} />
            </span>
        </Root>
    )
}
