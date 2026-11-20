import type { ReactNode } from 'react'
import { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

import { mix } from '@/theme/tokens'

import type { BuddyEyes, BuddyMood, BuddyMouth } from './look'
import { Blinking } from './motion'

// Ported from packages/ui/src/iso-grid/components/buddy/BuddyFace.tsx, without the eye glow filter.
// Drawn in the front-left wall's plane: the face is centred on x = 21, the eyes 10 units apart.
const CENTER = 21
export const BUDDY_FACE_CENTER = CENTER
const GAP = 5
const INK = 'rgba(255,255,255,0.94)'
const INK_HEX = '#f0f0f0'
const DARK = '#141419'
const HEART = '#ff6b9a'
const SOCKET = '#07070a'
const LIP = 'rgba(255,255,255,0.2)'

type EyeProps = { x: number; y: number }

function Pair({ y, children }: { y: number; children: (eye: EyeProps) => ReactNode }) {
    return (
        <>
            {[CENTER - GAP, CENTER + GAP].map(x => (
                <G key={x}>{children({ x, y })}</G>
            ))}
        </>
    )
}

function closed(x: number, y: number, color = INK) {
    return <Path d={`M${x - 2.4} ${y} Q${x} ${y + 2.2} ${x + 2.4} ${y}`} stroke={color} strokeWidth={1.5} strokeLinecap="round" fill="none" />
}

function cross(x: number, y: number, color = INK) {
    return <Path d={`M${x - 2} ${y - 2} L${x + 2} ${y + 2} M${x + 2} ${y - 2} L${x - 2} ${y + 2}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
}

function star(x: number, y: number, r: number) {
    const i = r * 0.32
    return `M${x} ${y - r} L${x + i} ${y - i} L${x + r} ${y} L${x + i} ${y + i} L${x} ${y + r} L${x - i} ${y + i} L${x - r} ${y} L${x - i} ${y - i} Z`
}

// A buddy that waits looks up, one that works looks down at what it does.
function gazeDrop(mood: BuddyMood) {
    return mood === 'waiting' ? -1.6 : mood === 'working' ? 1 : 0
}

function hasMouth(mouth: BuddyMouth, mood: BuddyMood) {
    return mouth !== 'none' || mood === 'error' || mood === 'waiting'
}

// The line the eyes sit on, the one they squash onto when they blink.
export function buddyEyeLine({ mouth, mood, depth }: Pick<BuddyFaceProps, 'mouth' | 'mood' | 'depth'>) {
    return depth * (hasMouth(mouth, mood) ? 0.38 : 0.45) + gazeDrop(mood)
}

type Paints = { ink: string; white: string; pupil: string; glass: string; lens: string; light: string; heart: string }
type Paint = (own: string) => string

// One eye shape set into the wall like a lit screen: a light lip under a dark socket, then the eye.
// `paint` turns the shape's own colour into the colour of the pass being drawn; `backing` is true
// for the two passes behind the eye. Unlit, the shape is painted flat.
function Solid({ lit, children }: { lit: boolean; children: (paint: Paint, backing: boolean) => ReactNode }) {
    const eye = children(own => own, false)
    if (!lit) return <>{eye}</>
    return (
        <>
            <G translateY={0.9} stroke={LIP} strokeWidth={2.2} strokeLinejoin="round">
                {children(() => LIP, true)}
            </G>
            <G stroke={SOCKET} strokeWidth={2.2} strokeLinejoin="round">
                {children(() => SOCKET, true)}
            </G>
            {eye}
        </>
    )
}

function EyeDefs({ uid, y, tint, light }: { uid: string; y: number; tint: string; light: string }) {
    return (
        <Defs>
            <LinearGradient id={`${uid}-ink`} x1="0" y1={y - 3.6} x2="0" y2={y + 3.6} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={mix(INK_HEX, '#ffffff', 0.6)} />
                <Stop offset="0.38" stopColor={mix(INK_HEX, tint, 0.12)} />
                <Stop offset="1" stopColor={mix(INK_HEX, tint, 0.7)} />
            </LinearGradient>
            <RadialGradient id={`${uid}-eye-white`} cx="40%" cy="30%" r="75%">
                <Stop offset="0" stopColor="#fff" />
                <Stop offset="0.55" stopColor="#f3f4f8" />
                <Stop offset="1" stopColor="#b3b9c9" />
            </RadialGradient>
            <RadialGradient id={`${uid}-pupil`} cx="38%" cy="30%" r="80%">
                <Stop offset="0" stopColor="#4a4d60" />
                <Stop offset="0.6" stopColor="#17171d" />
                <Stop offset="1" stopColor="#050507" />
            </RadialGradient>
            <LinearGradient id={`${uid}-glass`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#3b3e50" />
                <Stop offset="0.5" stopColor="#17181f" />
                <Stop offset="1" stopColor="#08080b" />
            </LinearGradient>
            <LinearGradient id={`${uid}-lens`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#fff" stopOpacity={0.3} />
                <Stop offset="1" stopColor="#fff" stopOpacity={0.02} />
            </LinearGradient>
            <LinearGradient id={`${uid}-visor-light`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#fff" />
                <Stop offset="1" stopColor={light} />
            </LinearGradient>
            <LinearGradient id={`${uid}-heart`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#ffb3cb" />
                <Stop offset="0.5" stopColor={HEART} />
                <Stop offset="1" stopColor="#e0366f" />
            </LinearGradient>
        </Defs>
    )
}

type EyesProps = { style: BuddyEyes; mood: BuddyMood; y: number; light: string; uid: string; lit: boolean }

function Eyes({ style, mood, y: baseY, light, uid, lit }: EyesProps) {
    const flat = !lit
    const P: Paints = flat
        ? { ink: INK, white: '#fff', pupil: DARK, glass: DARK, lens: 'rgba(255,255,255,0.08)', light, heart: HEART }
        : { ink: `url(#${uid}-ink)`, white: `url(#${uid}-eye-white)`, pupil: `url(#${uid}-pupil)`, glass: `url(#${uid}-glass)`, lens: `url(#${uid}-lens)`, light: `url(#${uid}-visor-light)`, heart: `url(#${uid}-heart)` }
    const solid = (shape: (paint: Paint, backing: boolean) => ReactNode) => <Solid lit={lit}>{shape}</Solid>
    const glint = (x: number, y: number, r = 0.62) => (lit ? <Ellipse cx={x - 0.55} cy={y} rx={r} ry={r * 1.15} fill="#fff" fillOpacity={0.95} /> : null)

    if (mood === 'asleep') return solid(paint => <Pair y={baseY}>{({ x, y }) => closed(x, y, paint(P.ink))}</Pair>)
    // Glasses and visors keep their frame when broken; everything else shows the crossed eyes.
    if (mood === 'error' && style !== 'visor' && style !== 'shades' && style !== 'glasses') return solid(paint => <Pair y={baseY}>{({ x, y }) => cross(x, y, paint(P.ink))}</Pair>)

    const lookX = mood === 'working' ? 1 : 0
    const lookY = gazeDrop(mood)
    const y = baseY + lookY
    const at = (x: number) => x + lookX

    switch (style) {
        case 'pill':
            return (
                <Blinking y={y}>
                    {solid(paint => <Pair y={y}>{e => <Ellipse cx={at(e.x)} cy={e.y} rx={1.9} ry={3.3} fill={paint(P.ink)} />}</Pair>)}
                    <Pair y={y}>{e => glint(at(e.x), e.y - 1.6)}</Pair>
                </Blinking>
            )
        case 'round':
            return (
                <Blinking y={y}>
                    {solid(paint => <Pair y={y}>{e => <Circle cx={at(e.x)} cy={e.y} r={2.3} fill={paint(P.ink)} />}</Pair>)}
                    <Pair y={y}>{e => glint(at(e.x), e.y - 0.9)}</Pair>
                </Blinking>
            )
        case 'dot':
            return <Blinking y={y}>{solid(paint => <Pair y={y}>{e => <Circle cx={at(e.x)} cy={e.y} r={1.25} fill={paint(P.ink)} />}</Pair>)}</Blinking>
        case 'happy':
            return solid(paint => <Pair y={y}>{e => <Path d={`M${at(e.x) - 2.6} ${e.y + 1} Q${at(e.x)} ${e.y - 2.6} ${at(e.x) + 2.6} ${e.y + 1}`} stroke={paint(P.ink)} strokeWidth={1.6} strokeLinecap="round" fill="none" />}</Pair>)
        case 'line':
            return solid(paint => <Pair y={y}>{e => <Path d={`M${at(e.x) - 2.4} ${e.y} L${at(e.x) + 2.4} ${e.y}`} stroke={paint(P.ink)} strokeWidth={1.6} strokeLinecap="round" />}</Pair>)
        case 'googly':
            return (
                <>
                    {solid(paint => <Pair y={y}>{e => <Circle cx={e.x} cy={e.y} r={3.6} fill={paint(P.white)} />}</Pair>)}
                    <Pair y={y}>
                        {e => (
                            <>
                                <Circle cx={e.x + lookX * 0.8} cy={e.y + 0.6 + lookY * 0.6} r={1.7} fill={P.pupil} />
                                {!flat && <Circle cx={e.x - 0.6 + lookX * 0.8} cy={e.y + lookY * 0.6} r={0.55} fill="#fff" />}
                            </>
                        )}
                    </Pair>
                </>
            )
        case 'cyclops':
            return (
                <Blinking y={y}>
                    {solid(paint => <Circle cx={CENTER} cy={y} r={4.4} fill={paint(P.white)} />)}
                    <Circle cx={CENTER + lookX} cy={y + 0.4 + lookY * 0.5} r={2.2} fill={P.pupil} />
                    <Circle cx={CENTER - 0.8 + lookX} cy={y - 0.6} r={0.7} fill="#fff" />
                </Blinking>
            )
        case 'visor':
            return (
                <G>
                    {solid((paint, backing) => <Rect x={CENTER - 12} y={y - 3.6} width={24} height={7.2} rx={3.6} fill={paint(P.glass)} stroke={backing ? undefined : INK} strokeOpacity={0.3} strokeWidth={backing ? undefined : 0.6} />)}
                    {!flat && <Path d={`M${CENTER - 9.5} ${y - 2.2} L${CENTER + 3} ${y - 2.2}`} stroke="#fff" strokeOpacity={0.22} strokeWidth={0.7} strokeLinecap="round" />}
                    {mood === 'error' ? (
                        <Pair y={y}>{e => cross(e.x, e.y, light)}</Pair>
                    ) : (
                        <Blinking y={y}>
                            <Pair y={y}>{e => <Rect x={at(e.x) - 2.2} y={e.y - 1.2} width={4.4} height={2.4} rx={1.2} fill={P.light} />}</Pair>
                        </Blinking>
                    )}
                </G>
            )
        case 'shades':
            return (
                <G>
                    <Path d={`M${CENTER - 2} ${y - 1.6} L${CENTER + 2} ${y - 1.6}`} stroke={DARK} strokeWidth={1.2} />
                    {solid((paint, backing) => <Pair y={y}>{e => <Rect x={e.x - 3.4} y={e.y - 2.6} width={6.8} height={5} rx={2} fill={paint(P.glass)} stroke={backing ? undefined : INK} strokeOpacity={0.45} strokeWidth={backing ? undefined : 0.6} />}</Pair>)}
                    <Pair y={y}>
                        {e =>
                            flat ? (
                                <Path d={`M${e.x - 2.2} ${e.y - 1.2} L${e.x - 0.6} ${e.y - 1.2}`} stroke="#fff" strokeOpacity={0.55} strokeWidth={0.7} strokeLinecap="round" />
                            ) : (
                                <Path d={`M${e.x - 2.4} ${e.y + 0.4} L${e.x - 0.2} ${e.y - 1.8}`} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.8} strokeLinecap="round" />
                            )
                        }
                    </Pair>
                    {mood === 'error' && <Path d={`M${CENTER - 3} ${y + 5} q3 -1.6 6 0`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" fill="none" />}
                </G>
            )
        case 'glasses':
            return (
                <G>
                    {solid((paint, backing) => (
                        <>
                            <Path d={`M${CENTER - 1.4} ${y - 0.6} Q${CENTER} ${y - 1.6} ${CENTER + 1.4} ${y - 0.6}`} stroke={paint(P.ink)} strokeWidth={0.9} fill="none" />
                            <Pair y={y}>{e => <Circle cx={e.x} cy={e.y} r={3.5} fill={backing ? 'none' : P.lens} stroke={paint(P.ink)} strokeWidth={0.9} />}</Pair>
                        </>
                    ))}
                    {mood === 'error' ? (
                        <Pair y={y}>{e => cross(e.x, e.y, P.ink)}</Pair>
                    ) : (
                        <Blinking y={y}>
                            <Pair y={y}>{e => <Circle cx={at(e.x)} cy={e.y + lookY * 0.3} r={1.2} fill={P.ink} />}</Pair>
                        </Blinking>
                    )}
                </G>
            )
        case 'sleepy':
            return (
                <>
                    {solid(paint => <Pair y={y}>{e => <Path d={`M${at(e.x) - 2.2} ${e.y - 0.6} L${at(e.x) + 2.2} ${e.y - 0.6} L${at(e.x) + 2.2} ${e.y + 1} A2.2 2.6 0 0 1 ${at(e.x) - 2.2} ${e.y + 1} Z`} fill={paint(P.ink)} />}</Pair>)}
                    <Pair y={y}>{e => glint(at(e.x), e.y + 0.4, 0.5)}</Pair>
                </>
            )
        case 'wink':
            return (
                <G>
                    {solid(paint => (
                        <>
                            <Ellipse cx={at(CENTER - GAP)} cy={y} rx={1.9} ry={3.3} fill={paint(P.ink)} />
                            <Path d={`M${at(CENTER + GAP) - 2.4} ${y} Q${at(CENTER + GAP)} ${y - 2.4} ${at(CENTER + GAP) + 2.4} ${y}`} stroke={paint(P.ink)} strokeWidth={1.5} strokeLinecap="round" fill="none" />
                        </>
                    ))}
                    {glint(at(CENTER - GAP), y - 1.6)}
                </G>
            )
        case 'pixel':
            return (
                <Blinking y={y}>
                    {solid(paint => <Pair y={y}>{e => <Rect x={at(e.x) - 1.9} y={e.y - 2.4} width={3.8} height={4.8} rx={0.6} fill={paint(P.ink)} />}</Pair>)}
                    {lit && <Pair y={y}>{e => <Rect x={at(e.x) - 1.3} y={e.y - 1.8} width={1.1} height={1.1} fill="#fff" />}</Pair>}
                </Blinking>
            )
        case 'star':
            return solid(paint => <Pair y={y}>{e => <Path d={star(at(e.x), e.y, 3.2)} fill={paint(P.ink)} />}</Pair>)
        case 'heart':
            return (
                <>
                    {solid(paint => (
                        <Pair y={y}>
                            {e => (
                                <Path
                                    d={`M${at(e.x)} ${e.y + 2.6} C${at(e.x) - 4.2} ${e.y - 0.4} ${at(e.x) - 2.6} ${e.y - 3.6} ${at(e.x)} ${e.y - 1.4} C${at(e.x) + 2.6} ${e.y - 3.6} ${at(e.x) + 4.2} ${e.y - 0.4} ${at(e.x)} ${e.y + 2.6} Z`}
                                    fill={paint(P.heart)}
                                />
                            )}
                        </Pair>
                    ))}
                    {!flat && <Pair y={y}>{e => <Ellipse cx={at(e.x) - 1.3} cy={e.y - 1.2} rx={0.6} ry={0.45} fill="#fff" fillOpacity={0.85} />}</Pair>}
                </>
            )
        case 'brows':
            return (
                <G>
                    {solid(paint => (
                        <>
                            <Path d={`M${CENTER - GAP - 2.6} ${y - 5.2} L${CENTER - GAP + 2.2} ${y - 4}`} stroke={paint(P.ink)} strokeWidth={1.3} strokeLinecap="round" />
                            <Path d={`M${CENTER + GAP + 2.6} ${y - 5.2} L${CENTER + GAP - 2.2} ${y - 4}`} stroke={paint(P.ink)} strokeWidth={1.3} strokeLinecap="round" />
                        </>
                    ))}
                    <Blinking y={y}>
                        {solid(paint => <Pair y={y}>{e => <Ellipse cx={at(e.x)} cy={e.y + 0.4} rx={1.8} ry={2.6} fill={paint(P.ink)} />}</Pair>)}
                        <Pair y={y}>{e => glint(at(e.x), e.y - 0.8, 0.55)}</Pair>
                    </Blinking>
                </G>
            )
        case 'sparkle':
            return (
                <G>
                    <Blinking y={y}>
                        {solid(paint => <Pair y={y}>{e => <Ellipse cx={at(e.x)} cy={e.y} rx={2.2} ry={3.4} fill={paint(P.ink)} />}</Pair>)}
                        <Pair y={y}>{e => glint(at(e.x), e.y - 1.6, 0.7)}</Pair>
                    </Blinking>
                    <Path d={star(CENTER + GAP + 4.6, y - 4.2, 1.8)} fill={light} />
                </G>
            )
    }
}

function Mouth({ mouth, mood, y }: { mouth: BuddyMouth; mood: BuddyMood; y: number }) {
    if (mood === 'error') return <Path d={`M${CENTER - 2.4} ${y + 0.8} Q${CENTER} ${y - 1.2} ${CENTER + 2.4} ${y + 0.8}`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" fill="none" />
    if (mood === 'waiting') return <Ellipse cx={CENTER} cy={y} rx={1.3} ry={1.6} fill={INK} />
    switch (mouth) {
        case 'smile':
            return <Path d={`M${CENTER - 2.4} ${y - 0.6} Q${CENTER} ${y + 1.8} ${CENTER + 2.4} ${y - 0.6}`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" fill="none" />
        case 'open':
            return <Path d={`M${CENTER - 2} ${y - 0.8} Q${CENTER} ${y + 2.8} ${CENTER + 2} ${y - 0.8} Z`} fill={INK} />
        case 'cat':
            return <Path d={`M${CENTER - 2.8} ${y - 0.4} Q${CENTER - 1.4} ${y + 1.6} ${CENTER} ${y - 0.4} Q${CENTER + 1.4} ${y + 1.6} ${CENTER + 2.8} ${y - 0.4}`} stroke={INK} strokeWidth={1.1} strokeLinecap="round" fill="none" />
        case 'flat':
            return <Path d={`M${CENTER - 1.8} ${y} L${CENTER + 1.8} ${y}`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" />
        case 'none':
            return null
    }
}

type BuddyFaceProps = {
    uid: string
    eyes: BuddyEyes
    mouth: BuddyMouth
    mood: BuddyMood
    depth: number
    light: string
    lit: boolean
    // The colour the eyes pick up towards their lower edge.
    tint: string
}

export function BuddyFace({ uid, eyes, mouth, mood, depth, light, lit, tint }: BuddyFaceProps) {
    const eyeY = buddyEyeLine({ mouth, mood, depth }) - gazeDrop(mood)
    return (
        <>
            {lit && <EyeDefs uid={uid} y={eyeY} tint={tint} light={light} />}
            <Eyes style={eyes} mood={mood} y={eyeY} light={light} uid={uid} lit={lit} />
            {hasMouth(mouth, mood) && mood !== 'asleep' && <Mouth mouth={mouth} mood={mood} y={eyeY + 6.6} />}
        </>
    )
}
