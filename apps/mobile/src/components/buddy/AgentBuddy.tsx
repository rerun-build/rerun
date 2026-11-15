import { useId, type ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { useTheme } from '@/theme/theme'

import { BUDDY_FACE_CENTER, BuddyFace } from './BuddyFace'
import { BUDDY_GEOMETRY, boxTop, leftWallPlane, roundedDiamond, wallsOutline, type BoxGeometry } from './geometry'
import { buddyColor, buddyEyes, buddyMouth, hashUnit, shade, type BuddyEyes, type BuddyLook, type BuddyMood } from './look'
import { BuddyMotionScope, GrowsFrom, RidesOnWalls, Sweep } from './motion'

const SMALL_BELOW = 40
const SMALL_GEOMETRY: BoxGeometry = { ...BUDDY_GEOMETRY, depth: 30 }
const SMALL_FACE_SCALE = 1.6
const SMALL_EYES: Partial<Record<BuddyEyes, BuddyEyes>> = { glasses: 'round', shades: 'visor', line: 'pill', dot: 'round' }
const MARGIN = 2

const STATE_COLOR: Record<'working' | 'error' | 'waiting', string> = { working: '#f59e0b', error: '#ef4444', waiting: '#06b6d4' }

function smallLook(agentId: string): BuddyLook {
    const eyes = buddyEyes(agentId, {})
    return { mouth: 'none', eyes: SMALL_EYES[eyes] ?? eyes }
}

type AgentBuddyProps = {
    agentId: string
    mood?: BuddyMood
    size: number
    animated?: boolean
    facing?: 'left' | 'right'
    style?: StyleProp<ViewStyle>
}

export function AgentBuddy({ agentId, mood = 'idle', size, animated = true, facing = 'left', style }: AgentBuddyProps) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
    const theme = useTheme()
    const small = size < SMALL_BELOW
    const geometry = small ? SMALL_GEOMETRY : BUDDY_GEOMETRY
    const look = small ? smallLook(agentId) : {}

    const side = geometry.halfW * 2 + MARGIN * 2
    const blockCentreY = geometry.base.y - geometry.depth / 2
    const viewBox = `${geometry.base.x - side / 2} ${blockCentreY - side / 2} ${side} ${side}`

    const body = mood === 'idle' ? theme.buddyBody : mood === 'asleep' ? theme.buddyAsleep : STATE_COLOR[mood]
    const resting = mood === 'idle' || mood === 'asleep'
    const identity = buddyColor(agentId, look)
    const top = resting ? shade(identity, mood === 'asleep' ? -0.6 : -0.12) : body
    const faceScale = small ? SMALL_FACE_SCALE : 1
    const motion = animated ? { kind: mood === 'working' ? ('bob' as const) : mood === 'error' ? ('shudder' as const) : null, offset: hashUnit(agentId, 7) * 4, blinkOffset: hashUnit(agentId, 9) * 4.6 } : null

    return (
        <View pointerEvents="none" style={[{ width: size, height: size, transform: facing === 'right' ? [{ scaleX: -1 }] : undefined, opacity: mood === 'asleep' ? 0.8 : 1 }, style]}>
            <BuddyMotionScope motion={mood === 'asleep' ? null : motion}>
                <Svg viewBox={viewBox} width="100%" height="100%">
                    <RoundedBox
                        uid={uid}
                        geometry={geometry}
                        color={body}
                        top={top}
                        topLight={mood === 'idle' ? 0.12 : 0.22}
                        rim={mood === 'idle' ? 0.22 : 0.32}
                        left={
                            <G transform={leftWallPlane(geometry)}>
                                <GrowsFrom y={geometry.depth}>
                                    <G transform={faceScale === 1 ? undefined : `translate(${BUDDY_FACE_CENTER * (1 - faceScale)} 0) scale(${faceScale})`}>
                                        <BuddyFace
                                            uid={uid}
                                            eyes={buddyEyes(agentId, look)}
                                            mouth={buddyMouth(agentId, look)}
                                            mood={mood}
                                            depth={geometry.depth / faceScale}
                                            light={resting ? shade(identity, 0.35) : '#ffffff'}
                                            lit={!small}
                                            tint={resting ? identity : body}
                                        />
                                    </G>
                                </GrowsFrom>
                            </G>
                        }
                        working={mood === 'working'}
                    />
                </Svg>
            </BuddyMotionScope>
        </View>
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
