import { useId, type ReactNode, type Ref } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated'
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { layerTransform, type Matrix } from '@/components/orb/orb-motion'
import { MaskedView } from '@/components/ui/MaskedView'
import { useTheme } from '@/theme/theme'

import { BUDDY_FACE_CENTER, BuddyFace, buddyBlinks, buddyEyeLine, type FacePart } from './BuddyFace'
import { BUDDY_GEOMETRY, boxTop, leftWallPlane, roundedDiamond, wallsOutline, type BoxGeometry, type Point } from './geometry'
import { buddyColor, buddyEyes, buddyMouth, hashUnit, shade, type BuddyEyes, type BuddyLook, type BuddyMood } from './look'
import { useBuddyLookOf } from './looks'
import { useBlinkScale, useStretch, useSweep, type BuddyMotion } from './motion'
import { inverted, multiplied, stretchedFrom, svgTransform } from './wall-motion'

// Ported from packages/ui/src/iso-grid/components/buddy (AgentBuddy, BuddyArt, RoundedBox): an
// agent's buddy away from the board, the same block, colour and eyes, the ones its coworker was
// given or else the ones its id hashes to.
//
// A buddy that holds still is one drawing. Whatever moves is a view of its own over it (the eyes that
// blink, the walls, the top and the band of light of one at work), drawn once and moved by its
// transform: moved inside the drawing, each frame committed the whole screen's tree and painted the
// buddy again.

// Below this width the board's block is too squat for its face to read: the buddy stands taller,
// its face is painted flat and larger, and it loses its mouth.
const SMALL_BELOW = 40
const SMALL_GEOMETRY: BoxGeometry = { ...BUDDY_GEOMETRY, depth: 30 }
const SMALL_FACE_SCALE = 1.6
// Eyes whose thin strokes do not survive a few pixels are drawn as their closest solid shape.
const SMALL_EYES: Partial<Record<BuddyEyes, BuddyEyes>> = { glasses: 'round', shades: 'visor', line: 'pill', dot: 'round' }
const MARGIN = 2

const STATE_COLOR: Record<'working' | 'error' | 'waiting', string> = { working: '#f59e0b', error: '#ef4444', waiting: '#06b6d4' }

// The band of light waits left of the top, then crosses it.
const SWEEP_START = -60
const SWEEP_TRAVEL = 160

function smallLook(agentId: string, look: BuddyLook): BuddyLook {
    const eyes = buddyEyes(agentId, look)
    return { ...look, mouth: 'none', eyes: SMALL_EYES[eyes] ?? eyes }
}

type AgentBuddyProps = {
    agentId: string
    mood?: BuddyMood
    // Width in points of the square the block is centred in.
    size: number
    // False holds it still, blink included: a long list of buddies should not twinkle.
    animated?: boolean
    // A buddy looks at what it stands next to: right when its text follows it, left when alone.
    facing?: 'left' | 'right'
    style?: StyleProp<ViewStyle>
    // The drawing itself, for whoever turns it into a picture (the widgets' faces): the one of a buddy
    // held still, a moving one being several.
    svgRef?: Ref<Svg>
}

export function AgentBuddy({ agentId, mood = 'idle', size, animated = true, facing = 'left', style, svgRef }: AgentBuddyProps) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const theme = useTheme()
    const reducedMotion = useReducedMotion()
    const small = size < SMALL_BELOW
    const geometry = small ? SMALL_GEOMETRY : BUDDY_GEOMETRY
    const worn = useBuddyLookOf(agentId)
    const look = small ? smallLook(agentId, worn) : worn

    const side = geometry.halfW * 2 + MARGIN * 2
    const blockCentreY = geometry.base.y - geometry.depth / 2
    const viewBox = `${geometry.base.x - side / 2} ${blockCentreY - side / 2} ${side} ${side}`
    const frame: LayerFrame = { viewBox, unit: size / side, centre: { x: geometry.base.x, y: blockCentreY } }

    const body = mood === 'idle' ? theme.buddyBody : mood === 'asleep' ? theme.buddyAsleep : STATE_COLOR[mood]
    const resting = mood === 'idle' || mood === 'asleep'
    const identity = buddyColor(agentId, look)
    const box: Box = { uid, geometry, color: body, top: resting ? shade(identity, mood === 'asleep' ? -0.6 : -0.12) : body, topLight: mood === 'idle' ? 0.12 : 0.22, rim: mood === 'idle' ? 0.22 : 0.32 }
    const faceScale = small ? SMALL_FACE_SCALE : 1
    const motion: BuddyMotion | null = animated && !reducedMotion && mood !== 'asleep' ? { kind: mood === 'working' ? 'bob' : mood === 'error' ? 'shudder' : null, offset: hashUnit(agentId, 7) * 4, blinkOffset: hashUnit(agentId, 9) * 4.6 } : null

    const eyes = buddyEyes(agentId, look)
    const mouth = buddyMouth(agentId, look)
    const wall = leftWallPlane(geometry)
    const faceFrame: Matrix = [faceScale, 0, 0, faceScale, BUDDY_FACE_CENTER * (1 - faceScale), 0]
    const faceDepth = geometry.depth / faceScale
    const blinks = motion !== null && buddyBlinks(eyes, mood)
    const face = (part: FacePart) => <BuddyFace uid={uid} eyes={eyes} mouth={mouth} mood={mood} depth={faceDepth} light={resting ? shade(identity, 0.35) : '#ffffff'} lit={!small} tint={resting ? identity : box.color} part={part} />
    const faceOnWall = <G transform={svgTransform(multiplied(wall, faceFrame))}>{face(blinks ? 'still' : 'all')}</G>

    return (
        <View pointerEvents="none" style={[{ width: size, height: size, transform: facing === 'right' ? [{ scaleX: -1 }] : undefined, opacity: mood === 'asleep' ? 0.8 : 1 }, style]}>
            {motion?.kind ? (
                <MovingBox {...box} {...frame} motion={motion} wall={wall} working={mood === 'working'}>
                    {faceOnWall}
                </MovingBox>
            ) : (
                <Svg ref={svgRef} viewBox={viewBox} width="100%" height="100%">
                    <Defs>
                        <ClipPath id={`${uid}-body-clip`}>
                            <Path d={wallsOutline(geometry)} />
                        </ClipPath>
                    </Defs>
                    <G clipPath={`url(#${uid}-body-clip)`}>
                        <Walls {...box} />
                        {faceOnWall}
                    </G>
                    <TopFace {...box} />
                    <TopEdge geometry={geometry} />
                </Svg>
            )}
            {motion && blinks && (
                <BuddyLids {...frame} motion={motion} wall={wall} wallDepth={geometry.depth} faceFrame={faceFrame} eyeLine={buddyEyeLine({ mouth, mood, depth: faceDepth })}>
                    {face('blinking')}
                </BuddyLids>
            )}
        </View>
    )
}

// A drawing laid over the buddy's square: its view box, the points one of its units takes, and the
// point of it that sits at the middle of the view.
type LayerFrame = { viewBox: string; unit: number; centre: Point }

function Layer({ viewBox, children }: { viewBox: string; children: ReactNode }) {
    return (
        <Svg viewBox={viewBox} width="100%" height="100%" style={StyleSheet.absoluteFill}>
            {children}
        </Svg>
    )
}

type BuddyLidsProps = LayerFrame & { motion: BuddyMotion; wall: Matrix; wallDepth: number; faceFrame: Matrix; eyeLine: number; children: ReactNode }

// The eyes that blink, in a view of their own over the buddy: its transform closes them onto their
// line and keeps them on the wall while it stretches.
function BuddyLids({ viewBox, unit, centre, motion, wall, wallDepth, faceFrame, eyeLine, children }: BuddyLidsProps) {
    const stretch = useStretch(motion)
    const blink = useBlinkScale(motion.blinkOffset)
    const drawn = multiplied(wall, faceFrame)
    const undrawn = inverted(drawn)
    const lids = useAnimatedStyle(() => {
        const stretched = multiplied(multiplied(wall, stretchedFrom(wallDepth, stretch.value)), faceFrame)
        const closed = multiplied(stretched, stretchedFrom(eyeLine, blink.value))
        return { transform: layerTransform(multiplied(closed, undrawn), unit, centre) }
    })
    return (
        <Animated.View style={[StyleSheet.absoluteFill, lids]}>
            <Layer viewBox={viewBox}>
                <G transform={svgTransform(drawn)}>{children}</G>
            </Layer>
        </Animated.View>
    )
}

// A thick, soft block: the rounded diamond swept down. The fold between the two visible walls is a
// gradient, the way light turns around a rounded edge. Only the top moves; the walls stretch under it.
type Box = { uid: string; geometry: BoxGeometry; color: string; top: string; topLight: number; rim: number }

function topDiamond(geometry: BoxGeometry) {
    return roundedDiamond(boxTop(geometry), geometry.halfW, geometry.halfH, geometry.radius)
}

function Walls({ uid, geometry, color }: Box) {
    const { halfW, halfH, depth } = geometry
    const topCenter = boxTop(geometry)
    const { sideInset } = topDiamond(geometry)
    const x0 = topCenter.x - halfW + sideInset
    const x1 = topCenter.x + halfW - sideInset
    const fill = { x: x0 - 2, y: topCenter.y, width: x1 - x0 + 4, height: depth + halfH + 2 }
    return (
        <>
            <Defs>
                <LinearGradient id={`${uid}-side`} x1={x0} x2={x1} y1="0" y2="0" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor={shade(color, -0.1)} />
                    <Stop offset="0.44" stopColor={shade(color, -0.26)} />
                    <Stop offset="0.56" stopColor={shade(color, -0.46)} />
                    <Stop offset="1" stopColor={shade(color, -0.6)} />
                </LinearGradient>
                <LinearGradient id={`${uid}-side-shade`} x1="0" y1={topCenter.y} x2="0" y2={geometry.base.y + halfH} gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#000" stopOpacity={0} />
                    <Stop offset="1" stopColor="#000" stopOpacity={0.35} />
                </LinearGradient>
            </Defs>
            <Rect {...fill} fill={`url(#${uid}-side)`} />
            <Rect {...fill} fill={`url(#${uid}-side-shade)`} />
        </>
    )
}

function TopFace({ uid, geometry, top, topLight, rim }: Box) {
    const { d } = topDiamond(geometry)
    return (
        <>
            <Defs>
                <RadialGradient id={`${uid}-top`} cx="42%" cy="35%" r="75%">
                    <Stop offset="0" stopColor={shade(top, topLight)} />
                    <Stop offset="1" stopColor={shade(top, -0.04)} />
                </RadialGradient>
                <ClipPath id={`${uid}-top-clip`}>
                    <Path d={d} />
                </ClipPath>
            </Defs>
            <Path d={d} fill={`url(#${uid}-top)`} />
            <G clipPath={`url(#${uid}-top-clip)`}>
                <Path d={d} fill="none" stroke="#fff" strokeOpacity={rim * 0.7} strokeWidth={2.2} translateY={1.4} />
            </G>
        </>
    )
}

function TopEdge({ geometry }: { geometry: BoxGeometry }) {
    return <Path d={topDiamond(geometry).d} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.7} />
}

type MovingBoxProps = Box & LayerFrame & { motion: BuddyMotion; wall: Matrix; working: boolean; children: ReactNode }

// The block of a buddy that bobs or shudders, in layers: the walls grow from the floor behind a
// window cut to their outline, the face (`children`) stretches with its wall, the top rides on them
// and, at work, a band of light crosses it.
function MovingBox({ viewBox, unit, centre, motion, wall, working, children, ...box }: MovingBoxProps) {
    const { uid, geometry } = box
    const { base, depth, halfW, halfH } = geometry
    const topCenter = boxTop(geometry)
    const unwall = inverted(wall)
    const stretch = useStretch(motion)
    const sweep = useSweep(working)
    const grown = useAnimatedStyle(() => ({ transform: layerTransform(stretchedFrom(base.y, stretch.value), unit, centre) }))
    const onWall = useAnimatedStyle(() => ({ transform: layerTransform(multiplied(multiplied(wall, stretchedFrom(depth, stretch.value)), unwall), unit, centre) }))
    const riding = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - stretch.value) * depth * unit }] }))
    const crossing = useAnimatedStyle(() => ({ transform: [{ translateX: (SWEEP_START + sweep.value * SWEEP_TRAVEL) * unit }] }))

    return (
        <>
            <MaskedView
                style={StyleSheet.absoluteFill}
                maskElement={
                    <Layer viewBox={viewBox}>
                        <Path d={wallsOutline(geometry)} fill="#000" />
                    </Layer>
                }
            >
                <Animated.View style={[StyleSheet.absoluteFill, grown]}>
                    <Layer viewBox={viewBox}>
                        <Walls {...box} />
                    </Layer>
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, onWall]}>
                    <Layer viewBox={viewBox}>{children}</Layer>
                </Animated.View>
            </MaskedView>
            <Animated.View style={[StyleSheet.absoluteFill, riding]}>
                <Layer viewBox={viewBox}>
                    <TopFace {...box} />
                </Layer>
                {working && (
                    <MaskedView
                        style={StyleSheet.absoluteFill}
                        maskElement={
                            <Layer viewBox={viewBox}>
                                <Path d={topDiamond(geometry).d} fill="#000" />
                            </Layer>
                        }
                    >
                        <Animated.View style={[StyleSheet.absoluteFill, crossing]}>
                            <Layer viewBox={viewBox}>
                                <Defs>
                                    <LinearGradient id={`${uid}-sweep`} x1="0" y1="0" x2="1" y2="0">
                                        <Stop offset="0" stopColor="#fff" stopOpacity={0} />
                                        <Stop offset="0.5" stopColor="#fff" stopOpacity={0.32} />
                                        <Stop offset="1" stopColor="#fff" stopOpacity={0} />
                                    </LinearGradient>
                                </Defs>
                                <Rect x={topCenter.x - halfW} y={topCenter.y - halfH} width={halfW} height={halfH * 2} fill={`url(#${uid}-sweep)`} />
                            </Layer>
                        </Animated.View>
                    </MaskedView>
                )}
                <Layer viewBox={viewBox}>
                    <TopEdge geometry={geometry} />
                </Layer>
            </Animated.View>
        </>
    )
}
