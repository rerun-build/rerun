import { useId, type ReactNode, type Ref } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated'
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { layerTransform, type Matrix } from '@/components/orb/orb-motion'
import { useTheme } from '@/theme/theme'

import { BUDDY_FACE_CENTER, BuddyFace, buddyBlinks, buddyEyeLine, type FacePart } from './BuddyFace'
import { BUDDY_GEOMETRY, boxTop, leftWallPlane, roundedDiamond, wallsOutline, type BoxGeometry, type Point } from './geometry'
import { buddyColor, buddyEyes, buddyMouth, hashUnit, shade, type BuddyEyes, type BuddyLook, type BuddyMood } from './look'
import { useBuddyLookOf } from './looks'
import { BuddyMotionScope, GrowsFrom, RidesOnWalls, Sweep, useBlinkScale, useStretch } from './motion'
import { inverted, multiplied, stretchedFrom, svgTransform } from './wall-motion'

// Ported from packages/ui/src/iso-grid/components/buddy (AgentBuddy, BuddyArt, RoundedBox): an
// agent's buddy away from the board, the same block, colour and eyes, the ones its coworker was
// given or else the ones its id hashes to.

// Below this width the board's block is too squat for its face to read: the buddy stands taller,
// its face is painted flat and larger, and it loses its mouth.
const SMALL_BELOW = 40
const SMALL_GEOMETRY: BoxGeometry = { ...BUDDY_GEOMETRY, depth: 30 }
const SMALL_FACE_SCALE = 1.6
// Eyes whose thin strokes do not survive a few pixels are drawn as their closest solid shape.
const SMALL_EYES: Partial<Record<BuddyEyes, BuddyEyes>> = { glasses: 'round', shades: 'visor', line: 'pill', dot: 'round' }
const MARGIN = 2

const STATE_COLOR: Record<'working' | 'error' | 'waiting', string> = { working: '#f59e0b', error: '#ef4444', waiting: '#06b6d4' }

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
    // The drawing itself, for whoever turns it into a picture (the widgets' faces).
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

    const body = mood === 'idle' ? theme.buddyBody : mood === 'asleep' ? theme.buddyAsleep : STATE_COLOR[mood]
    const resting = mood === 'idle' || mood === 'asleep'
    const identity = buddyColor(agentId, look)
    const top = resting ? shade(identity, mood === 'asleep' ? -0.6 : -0.12) : body
    const faceScale = small ? SMALL_FACE_SCALE : 1
    const motion = animated && mood !== 'asleep' ? { kind: mood === 'working' ? ('bob' as const) : mood === 'error' ? ('shudder' as const) : null, offset: hashUnit(agentId, 7) * 4, blinkOffset: hashUnit(agentId, 9) * 4.6 } : null

    const eyes = buddyEyes(agentId, look)
    const mouth = buddyMouth(agentId, look)
    const wall = leftWallPlane(geometry)
    const faceFrame: Matrix = [faceScale, 0, 0, faceScale, BUDDY_FACE_CENTER * (1 - faceScale), 0]
    const faceDepth = geometry.depth / faceScale
    const blinks = motion !== null && !reducedMotion && buddyBlinks(eyes, mood)
    const face = (part: FacePart) => <BuddyFace uid={uid} eyes={eyes} mouth={mouth} mood={mood} depth={faceDepth} light={resting ? shade(identity, 0.35) : '#ffffff'} lit={!small} tint={resting ? identity : body} part={part} />

    return (
        <View pointerEvents="none" style={[{ width: size, height: size, transform: facing === 'right' ? [{ scaleX: -1 }] : undefined, opacity: mood === 'asleep' ? 0.8 : 1 }, style]}>
            <BuddyMotionScope motion={motion}>
                <Svg ref={svgRef} viewBox={viewBox} width="100%" height="100%">
                    <RoundedBox
                        uid={uid}
                        geometry={geometry}
                        color={body}
                        top={top}
                        topLight={mood === 'idle' ? 0.12 : 0.22}
                        rim={mood === 'idle' ? 0.22 : 0.32}
                        left={
                            <G transform={svgTransform(wall)}>
                                <GrowsFrom y={geometry.depth}>
                                    <G transform={svgTransform(faceFrame)}>{face(blinks ? 'still' : 'all')}</G>
                                </GrowsFrom>
                            </G>
                        }
                        working={mood === 'working'}
                    />
                </Svg>
                {motion && blinks && (
                    <BuddyLids
                        viewBox={viewBox}
                        unit={size / side}
                        centre={{ x: geometry.base.x, y: blockCentreY }}
                        wall={wall}
                        wallDepth={geometry.depth}
                        faceFrame={faceFrame}
                        eyeLine={buddyEyeLine({ mouth, mood, depth: faceDepth })}
                        blinkOffset={motion.blinkOffset}
                    >
                        {face('blinking')}
                    </BuddyLids>
                )}
            </BuddyMotionScope>
        </View>
    )
}

type BuddyLidsProps = {
    viewBox: string
    // Points per unit of the drawing, and the point of the drawing at the middle of the view.
    unit: number
    centre: Point
    wall: Matrix
    wallDepth: number
    faceFrame: Matrix
    eyeLine: number
    blinkOffset: number
    children: ReactNode
}

// The eyes that blink, in a view of their own over the buddy. Its transform closes them onto their
// line and keeps them on the wall while it stretches, so a blink costs neither a commit of the tree
// nor a new painting of the buddy.
function BuddyLids({ viewBox, unit, centre, wall, wallDepth, faceFrame, eyeLine, blinkOffset, children }: BuddyLidsProps) {
    const { stretch } = useStretch()
    const blink = useBlinkScale(blinkOffset)
    const drawn = multiplied(wall, faceFrame)
    const undrawn = inverted(drawn)
    const lids = useAnimatedStyle(() => {
        const stretched = multiplied(multiplied(wall, stretchedFrom(wallDepth, stretch())), faceFrame)
        const closed = multiplied(stretched, stretchedFrom(eyeLine, blink.value))
        return { transform: layerTransform(multiplied(closed, undrawn), unit, centre) }
    })
    return (
        <Animated.View style={[StyleSheet.absoluteFill, lids]}>
            <Svg viewBox={viewBox} width="100%" height="100%">
                <G transform={svgTransform(drawn)}>{children}</G>
            </Svg>
        </Animated.View>
    )
}

type RoundedBoxProps = {
    uid: string
    geometry: BoxGeometry
    color: string
    top: string
    topLight: number
    rim: number
    left: ReactNode
    working: boolean
}

// A thick, soft block: the rounded diamond swept down. The fold between the two visible walls is a
// gradient, the way light turns around a rounded edge. Only the top moves; the walls stretch under it.
function RoundedBox({ uid, geometry, color, top, topLight, rim, left, working }: RoundedBoxProps) {
    const { halfW, halfH, depth, radius } = geometry
    const topCenter = boxTop(geometry)
    const topShape = roundedDiamond(topCenter, halfW, halfH, radius)
    const x0 = topCenter.x - halfW + topShape.sideInset
    const x1 = topCenter.x + halfW - topShape.sideInset
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
                <RadialGradient id={`${uid}-top`} cx="42%" cy="35%" r="75%">
                    <Stop offset="0" stopColor={shade(top, topLight)} />
                    <Stop offset="1" stopColor={shade(top, -0.04)} />
                </RadialGradient>
                <LinearGradient id={`${uid}-sweep`} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor="#fff" stopOpacity={0} />
                    <Stop offset="0.5" stopColor="#fff" stopOpacity={0.32} />
                    <Stop offset="1" stopColor="#fff" stopOpacity={0} />
                </LinearGradient>
                <ClipPath id={`${uid}-top-clip`}>
                    <Path d={topShape.d} />
                </ClipPath>
                <ClipPath id={`${uid}-body-clip`}>
                    <Path d={wallsOutline(geometry)} />
                </ClipPath>
            </Defs>

            <G clipPath={`url(#${uid}-body-clip)`}>
                <GrowsFrom y={geometry.base.y}>
                    <Rect {...fill} fill={`url(#${uid}-side)`} />
                    <Rect {...fill} fill={`url(#${uid}-side-shade)`} />
                </GrowsFrom>
                {left}
            </G>

            <RidesOnWalls depth={depth}>
                <Path d={topShape.d} fill={`url(#${uid}-top)`} />
                <G clipPath={`url(#${uid}-top-clip)`}>
                    <Path d={topShape.d} fill="none" stroke="#fff" strokeOpacity={rim * 0.7} strokeWidth={2.2} translateY={1.4} />
                    {working && <Sweep x={topCenter.x - halfW} y={topCenter.y - halfH} width={halfW} height={halfH * 2} fill={`url(#${uid}-sweep)`} />}
                </G>
                <Path d={topShape.d} fill="none" stroke="#fff" strokeOpacity={0.2} strokeWidth={0.7} />
            </RidesOnWalls>
        </>
    )
}
