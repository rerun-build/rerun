import { BUDDY_HEIGHT_RATIO } from '../../iso'
import type { BuddyLook } from '../../types'
import { BUDDY_FACE_CENTER, BuddyFace } from './BuddyFace'
import { BUDDY_STATE_COLOR, buddyColor, buddyEyes, buddyMouth, shade, type BuddyMood } from './buddy-look'
import { MATERIAL_RADIUS } from './BuddyMaterial'
import { GrowsFrom, RoundedBox, boxTop, leftWallPlane, type BoxGeometry } from './RoundedBox'

// Drawn in a 100-unit box whose floor point is (50, 86), the centre of the block's bottom diamond.
export const BUDDY_VIEW = { x: -16, y: -20, w: 132, h: 132 }
const HALF_W = 40
export const BUDDY_GEOMETRY: BoxGeometry = { base: { x: 50, y: 86 }, halfW: HALF_W, halfH: HALF_W / 2, depth: HALF_W * 2 * BUDDY_HEIGHT_RATIO, radius: 9 }

type BuddyArtProps = {
    uid: string
    id: string
    mood: BuddyMood
    look: BuddyLook
    // Paints the whole block in one colour, top included: a placement ghost has no identity yet.
    plain?: string
    geometry?: BoxGeometry
    // False paints the face flat, without the lit screen's gradients and filters: what a buddy
    // drawn a few pixels wide needs to stay crisp.
    lit?: boolean
    // Enlarges the face around its centre, on a wall tall enough to hold it.
    faceScale?: number
    // How many CSS pixels one unit of the drawing takes: a material's relief flattens when drawn small.
    detail?: number
}

// What tints a chrome block: the coworker's colour barely, a state hard enough to read on the board.
const CHROME_IDLE_SHARE = 20
const CHROME_STATE_SHARE = 42

// Today's tile grown into a soft block with a face. At rest its top wears the agent's colour, the
// only colour on it, or the whole block does when it is made of a material; at work, broken or
// waiting, the whole block takes the state's colour instead.
export function BuddyArt({ uid, id, mood, look, plain, geometry: baseGeometry = BUDDY_GEOMETRY, lit = !plain, faceScale = 1, detail }: BuddyArtProps) {
    const material = plain ? 'classic' : (look.material ?? 'classic')
    const classic = material === 'classic'
    const geometry = { ...baseGeometry, radius: MATERIAL_RADIUS[material] ?? baseGeometry.radius }
    const resting = mood === 'idle' || mood === 'asleep'
    const identity = buddyColor(id, look)
    const body = plain ?? (mood === 'idle' && !classic ? identity : BUDDY_STATE_COLOR[mood])
    const top = !plain && resting ? shade(identity, mood === 'asleep' ? -0.6 : classic ? -0.12 : 0.06) : body
    const chromeTint = mood === 'idle' ? { color: identity, share: CHROME_IDLE_SHARE } : { color: body, share: CHROME_STATE_SHARE }
    const t = boxTop(geometry)

    return (
        <>
            {mood === 'working' && (
                <defs>
                    <linearGradient id={`${uid}-sweep`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#fff" stopOpacity="0" />
                        <stop offset="50%" stopColor="#fff" stopOpacity="0.32" />
                        <stop offset="100%" stopColor="#fff" stopOpacity="0" />
                    </linearGradient>
                </defs>
            )}
            <RoundedBox
                uid={uid}
                geometry={geometry}
                color={body}
                top={top}
                topLight={mood === 'idle' ? 0.12 : 0.22}
                rim={mood === 'idle' ? 0.22 : 0.32}
                material={material}
                detail={detail}
                chromeTint={chromeTint}
                left={
                    <g transform={leftWallPlane(geometry)}>
                        <GrowsFrom y={geometry.depth} painted>
                            <g transform={faceScale === 1 ? undefined : `translate(${BUDDY_FACE_CENTER * (1 - faceScale)} 0) scale(${faceScale})`}>
                                <BuddyFace
                                    uid={uid}
                                    eyes={buddyEyes(id, look)}
                                    mouth={buddyMouth(id, look)}
                                    mood={mood}
                                    depth={geometry.depth / faceScale}
                                    light={resting && !plain ? shade(identity, 0.35) : '#fff'}
                                    lit={lit}
                                    tint={resting ? identity : body}
                                />
                            </g>
                        </GrowsFrom>
                    </g>
                }
                onTop={mood === 'working' ? <rect className="iso-buddy-sweep" x={t.x - geometry.halfW} y={t.y - geometry.halfH} width={geometry.halfW} height={geometry.halfH * 2} fill={`url(#${uid}-sweep)`} /> : undefined}
            />
        </>
    )
}
