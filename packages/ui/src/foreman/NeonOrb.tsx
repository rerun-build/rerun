'use client'

import { useAnimationFrame, useReducedMotion } from 'motion/react'
import { useId, useMemo, useRef } from 'react'

import { cn } from '../cn'

import type { OrbProps } from './Orb'
import { OrbDefs } from './OrbDefs'
import { BLOB_HARMONICS, blobPath } from './blob-geometry'
import { ORB_TUNING, approachTuning, type OrbTuning } from './orb-tuning'
import { useKitTranslations } from '../locale'

const VIEW = 100
const CENTER = VIEW / 2
const SAMPLES = 64

// La boîte du svg vaut 1,8 fois le diamètre de la bille : le bloom déborde largement du contour et
// un filtre ne peut pas peindre hors de sa surface. `size` reste le diamètre, pas la boîte.
const BLOOM_SCALE = 1.8
const RADIUS = VIEW / 2 / BLOOM_SCALE

const EYE_Y = CENTER - 0.8
const EYE_GAP = RADIUS * 0.16

// Les yeux valent 1,2% du diamètre : à 32px ils tomberaient sous le demi-pixel. On garde la
// proportion tant qu'elle tient, et on pose un plancher en pixels écran en dessous.
function eyeSize(size: number) {
    const unit = (size * BLOOM_SCALE) / VIEW
    const rx = Math.max(1.5, size * 0.0125) / unit
    return { rx, ry: rx * 2.15 }
}

// Jusqu'où les yeux vont quand la bille regarde quelque chose, en unités du viewBox : assez pour
// qu'on lise la direction, jamais assez pour qu'ils touchent le liseré.
const LOOK_X = RADIUS * 0.26
const LOOK_Y = RADIUS * 0.18

/**
 * L'ancienne bête du Foreman, gardée pour la comparer à la boule dans le lab : un contour
 * paramétrique (huit lobes que deux harmoniques déséquilibrent),
 * quatre couches de néon, deux plis de verre et un regard. Les quatre états ne changent jamais la
 * forme ni les couleurs, seulement le rythme — c'est la même bête qui respire autrement.
 */
export function NeonOrb({ state = 'idle', size, onClick, label, paused = false, gaze, className }: OrbProps) {
    const t = useKitTranslations()
    const reducedMotion = useReducedMotion()
    // Les ids de React 19 contiennent des caractères qu'un `url(#…)` ne sait pas lire.
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const { rx, ry } = eyeSize(size)
    const box = size * BLOOM_SCALE

    const pathRef = useRef<SVGPathElement>(null)
    const bodyRef = useRef<SVGGElement>(null)
    const bloomRef = useRef<SVGGElement>(null)
    const eyesRef = useRef<SVGGElement>(null)
    const rimRef = useRef<SVGLinearGradientElement>(null)

    const tuningRef = useRef<OrbTuning>({ ...ORB_TUNING[state] })
    const clockRef = useRef({ phase: 0, breath: 0, rim: 0, gaze: 0, nextBlink: 2.5, blinkAt: -1, lookX: 0, lookY: 0 })

    const initialPath = useMemo(
        () => blobPath({ harmonics: BLOB_HARMONICS, samples: SAMPLES, radius: RADIUS, center: CENTER, amp: ORB_TUNING[state].amp, phase: 0 }),
        // La silhouette au premier rendu ne dépend que de l'état initial ; ensuite c'est la boucle
        // qui écrit `d`, et un recalcul ici écraserait la frame en cours.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    )

    // Rien ne passe par un re-render : la boucle écrit un attribut `d` et trois `transform`, et
    // toutes les couches de néon partagent le même contour par `<use>`.
    useAnimationFrame((ms, deltaMs) => {
        if (reducedMotion || paused) return
        const t = ms / 1000
        const dt = Math.min(deltaMs / 1000, 0.05)
        const tuning = tuningRef.current
        const clock = clockRef.current
        approachTuning(tuning, ORB_TUNING[state], dt)

        clock.phase += dt * tuning.churn
        clock.breath += dt * tuning.breatheRate
        clock.rim += dt * (9 + tuning.churn * 11)
        clock.gaze += dt * tuning.gazeRate

        pathRef.current?.setAttribute('d', blobPath({ harmonics: BLOB_HARMONICS, samples: SAMPLES, radius: RADIUS, center: CENTER, amp: tuning.amp, phase: clock.phase }))

        const scale = 1 + tuning.breathe * Math.sin(clock.breath)
        bodyRef.current?.setAttribute('transform', `translate(${CENTER} ${CENTER}) scale(${scale.toFixed(4)}) translate(${-CENTER} ${-CENTER})`)
        bloomRef.current?.setAttribute('opacity', (tuning.bloom * (0.82 + 0.18 * Math.sin(clock.breath * 1.3))).toFixed(3))
        rimRef.current?.setAttribute('gradientTransform', `rotate(${(clock.rim % 360).toFixed(2)} 0.5 0.5)`)

        // Le regard balaie deux sinusoïdes incommensurables : une seule ferait un va-et-vient de
        // métronome, et c'est ce qui trahit tout de suite une boucle.
        const wander = (Math.sin(clock.gaze * 1.7) * 0.6 + Math.sin(clock.gaze * 4.3 + 1.1) * 0.4) * rx * tuning.gaze
        const lift = (Math.sin(clock.gaze * 1.1 + 2.3) * 0.5 + Math.sin(clock.gaze * 3.1) * 0.3) * rx * tuning.gaze * 0.55

        // Un regard posé sur quelque chose garde un reste de dérive, sinon les yeux se figent comme
        // ceux d'une poupée ; il y va et en revient en douceur plutôt que d'y sauter.
        const target = gaze?.current ?? null
        const ease = 1 - Math.exp(-dt * 9)
        clock.lookX += ((target ? target.x * LOOK_X : 0) - clock.lookX) * ease
        clock.lookY += ((target ? target.y * LOOK_Y : 0) - clock.lookY) * ease
        const drift = target ? 0.3 : 1
        const eyeX = wander * drift + clock.lookX
        const eyeY = lift * drift + clock.lookY

        if (t >= clock.nextBlink && clock.blinkAt < 0) {
            clock.blinkAt = t
            clock.nextBlink = t + tuning.blinkEvery * (0.55 + Math.random())
        }
        let lid = 1
        if (clock.blinkAt >= 0) {
            const progress = (t - clock.blinkAt) / 0.13
            if (progress >= 1) clock.blinkAt = -1
            else lid = 1 - 0.94 * Math.sin(progress * Math.PI)
        }
        const openness = (tuning.openness * lid).toFixed(4)
        eyesRef.current?.setAttribute('transform', `translate(${eyeX.toFixed(3)} ${eyeY.toFixed(3)}) translate(${CENTER} ${EYE_Y}) scale(1 ${openness}) translate(${-CENTER} ${-EYE_Y})`)
    })

    const Root = onClick ? 'button' : 'span'
    const rim = `url(#${uid}-rim)`

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
            <svg
                aria-hidden
                viewBox={`0 0 ${VIEW} ${VIEW}`}
                width={box}
                height={box}
                className="pointer-events-none absolute"
                style={{ left: -(box - size) / 2, top: -(box - size) / 2 }}
            >
                <OrbDefs uid={uid} initialPath={initialPath} pathRef={pathRef} rimRef={rimRef} />

                <circle cx={CENTER} cy={CENTER} r={RADIUS * 1.72} fill={`url(#${uid}-atmo)`} />

                <g ref={bodyRef}>
                    {/* Le corps d'abord, opaque : sous la bille il y a le board, et on ne doit jamais
                        le voir au travers. Les halos passent ensuite PAR-DESSUS, c'est ce qui teinte
                        la face interne du liseré au lieu de s'arrêter net sur le contour. */}
                    <use href={`#${uid}-d`} fill={`url(#${uid}-core)`} />

                    <g ref={bloomRef} opacity={ORB_TUNING[state].bloom}>
                        <use href={`#${uid}-d`} fill="none" stroke={rim} strokeWidth={6} filter={`url(#${uid}-bloom)`} opacity={0.62} />
                        <use href={`#${uid}-d`} fill="none" stroke={rim} strokeWidth={2.4} filter={`url(#${uid}-halo)`} opacity={0.95} />
                        <use href={`#${uid}-d`} fill="none" stroke="#ffffff" strokeWidth={0.95} filter={`url(#${uid}-edge)`} opacity={0.97} />
                    </g>

                    {/* L'épaisseur du verre : deux plis rentrés, coupés au contour pour qu'ils ne
                        débordent jamais du liseré. */}
                    <g clipPath={`url(#${uid}-clip)`}>
                        <use href={`#${uid}-d`} fill="none" stroke={`url(#${uid}-sheen)`} strokeWidth={0.9} opacity={0.5} filter={`url(#${uid}-edge)`} transform={`translate(${CENTER} ${CENTER}) scale(0.945) translate(${-CENTER} ${-CENTER})`} />
                        <use href={`#${uid}-d`} fill="none" stroke={`url(#${uid}-sheen)`} strokeWidth={0.6} opacity={0.3} filter={`url(#${uid}-edge)`} transform={`translate(${CENTER} ${CENTER}) scale(0.89) translate(${-CENTER} ${-CENTER})`} />
                    </g>

                    <g ref={eyesRef}>
                        <g filter={`url(#${uid}-eye)`} opacity={0.75}>
                            <ellipse cx={CENTER - EYE_GAP} cy={EYE_Y} rx={rx * 1.5} ry={ry * 1.25} fill="#d9b8ff" />
                            <ellipse cx={CENTER + EYE_GAP} cy={EYE_Y} rx={rx * 1.5} ry={ry * 1.25} fill="#d9b8ff" />
                        </g>
                        <ellipse cx={CENTER - EYE_GAP} cy={EYE_Y} rx={rx} ry={ry} fill={`url(#${uid}-iris)`} />
                        <ellipse cx={CENTER + EYE_GAP} cy={EYE_Y} rx={rx} ry={ry} fill={`url(#${uid}-iris)`} />
                    </g>
                </g>
            </svg>
        </Root>
    )
}
