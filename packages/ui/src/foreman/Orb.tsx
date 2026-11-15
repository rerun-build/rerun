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

const LOOK_X = 3.6
const LOOK_Y = 2.2
const WANDER = 0.5

const DEGREES = Math.PI / 180
const TURN_TO_X = 42 * DEGREES
const TURN_TO_Y = 24 * DEGREES
const NOD_RATE = 7
const SPIN_SECONDS = 0.7
const SPIN_EVERY = 5

function easeInOut(progress: number) {
    return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2
}

export type OrbGaze = { x: number; y: number }

export type OrbProps = {
    state?: OrbActivity
    size: number
    onClick?: () => void
    label?: string
    paused?: boolean
    gaze?: RefObject<OrbGaze | null>
    facing?: ForemanFacing
    className?: string
}

export function Orb({ state = 'idle', size, onClick, label, paused = false, gaze, facing = 'left', className }: OrbProps) {
    const t = useKitTranslations()
    const reducedMotion = useReducedMotion()
    const rest = foremanFaceRest(facing)
    const [ball, setBall] = useState<HTMLSpanElement | null>(null)
    const ballRef = useMemo(() => ({ current: ball }), [ball])
    const eyesRef = useRef<SVGGElement>(null)
    const tuningRef = useRef<OrbTuning>({ ...ORB_TUNING[state] })
    const faceRef = useRef<SVGGElement>(null)
    const clockRef = useRef({ gaze: 0, lookX: 0, lookY: 0, turn: 0, nod: 0, yaw: rest.yaw, pitch: rest.pitch, spin: 1, spinSide: 1, nextSpin: 0, atRest: true })
    const onScreen = useOnScreen(ballRef)
    const still = reducedMotion || paused || !onScreen

    useAnimationFrame((_, deltaMs) => {
        if (still) {
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

        const wander = (Math.sin(clock.gaze * 1.7) * 0.6 + Math.sin(clock.gaze * 4.3 + 1.1) * 0.4) * WANDER * tuning.gaze
        const lift = (Math.sin(clock.gaze * 1.1 + 2.3) * 0.5 + Math.sin(clock.gaze * 3.1) * 0.3) * WANDER * tuning.gaze * 0.55

        const target = gaze?.current ?? null
        const ease = 1 - Math.exp(-dt * 9)
        clock.lookX += ((target ? target.x * LOOK_X : 0) - clock.lookX) * ease
        clock.lookY += ((target ? target.y * LOOK_Y : 0) - clock.lookY) * ease
        const drift = target ? 0.3 : 1
        eyesRef.current?.setAttribute('transform', `translate(${(wander * drift + clock.lookX).toFixed(3)} ${(lift * drift + clock.lookY).toFixed(3)})`)

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
