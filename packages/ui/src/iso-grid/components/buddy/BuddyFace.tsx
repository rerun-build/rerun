import type { ReactNode } from 'react'
import type { BuddyEyes, BuddyMouth } from '../../types'
import type { BuddyMood } from './buddy-look'

const CENTER = 21
export const BUDDY_FACE_CENTER = CENTER
const GAP = 5
const INK = 'rgb(255 255 255 / 0.94)'
const DARK = '#141419'
const HEART = '#ff6b9a'
const SOCKET = '#07070a'
const LIP = 'rgb(255 255 255 / 0.2)'

type EyeProps = { x: number; y: number }

function blinking(y: number) {
    return { className: 'iso-buddy-eyes', style: { transformOrigin: `${CENTER}px ${y}px` } }
}

function lids(y: number) {
    return { className: 'iso-buddy-lids', style: { transformOrigin: `${CENTER}px ${y}px` } }
}

function Pair({ y, children }: { y: number; children: (eye: EyeProps) => ReactNode }) {
    return <>{[CENTER - GAP, CENTER + GAP].map(x => <g key={x}>{children({ x, y })}</g>)}</>
}

function closed(x: number, y: number, color = INK) {
    return <path d={`M${x - 2.4} ${y} Q${x} ${y + 2.2} ${x + 2.4} ${y}`} stroke={color} strokeWidth={1.5} strokeLinecap="round" fill="none" />
}

function cross(x: number, y: number, color = INK) {
    return <path d={`M${x - 2} ${y - 2} L${x + 2} ${y + 2} M${x + 2} ${y - 2} L${x - 2} ${y + 2}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
}

function star(x: number, y: number, r: number) {
    const i = r * 0.32
    return `M${x} ${y - r} L${x + i} ${y - i} L${x + r} ${y} L${x + i} ${y + i} L${x} ${y + r} L${x - i} ${y + i} L${x - r} ${y} L${x - i} ${y - i} Z`
}

type Paints = { ink: string; white: string; pupil: string; glass: string; lens: string; light: string; heart: string }
type Paint = (own: string) => string

function Solid({ uid, lit, children }: { uid: string; lit: boolean; children: (paint: Paint, backing: boolean) => ReactNode }) {
    const eye = children(own => own, false)
    if (!lit) return <>{eye}</>
    return (
        <>
            <g transform="translate(0 0.9)" stroke={LIP} strokeWidth={2.2} strokeLinejoin="round">{children(() => LIP, true)}</g>
            <g stroke={SOCKET} strokeWidth={2.2} strokeLinejoin="round">{children(() => SOCKET, true)}</g>
            <g filter={`url(#${uid}-eye-glow)`}>{eye}</g>
        </>
    )
}

type EyePaint = Exclude<keyof Paints, 'white'> | 'eye-white'

const INK_ONLY: ReadonlySet<EyePaint> = new Set(['ink'])
const EYEBALL: ReadonlySet<EyePaint> = new Set(['eye-white', 'pupil'])
const VISOR: ReadonlySet<EyePaint> = new Set(['glass', 'light'])
const SHADES: ReadonlySet<EyePaint> = new Set(['glass'])
const GLASSES: ReadonlySet<EyePaint> = new Set(['ink', 'lens'])
const HEARTS: ReadonlySet<EyePaint> = new Set(['heart'])

function eyePaints(style: BuddyEyes, mood: BuddyMood): ReadonlySet<EyePaint> {
    const keepsFrame = style === 'visor' || style === 'shades' || style === 'glasses'
    if (mood === 'asleep' || (mood === 'error' && !keepsFrame)) return INK_ONLY
    switch (style) {
        case 'googly':
        case 'cyclops':
            return EYEBALL
        case 'visor':
            return VISOR
        case 'shades':
            return SHADES
        case 'glasses':
            return GLASSES
        case 'heart':
            return HEARTS
        default:
            return INK_ONLY
    }
}

function EyeDefs({ uid, y, tint, light, paints }: { uid: string; y: number; tint: string; light: string; paints: ReadonlySet<EyePaint> }) {
    const lit = (share: number) => `color-mix(in srgb, ${INK}, ${tint} ${share}%)`
    return (
        <defs>
            {paints.has('ink') && <linearGradient id={`${uid}-ink`} x1="0" y1={y - 3.6} x2="0" y2={y + 3.6} gradientUnits="userSpaceOnUse">
                <stop offset="0%" style={{ stopColor: `color-mix(in srgb, ${INK}, white 60%)` }} />
                <stop offset="38%" style={{ stopColor: lit(12) }} />
                <stop offset="100%" style={{ stopColor: lit(70) }} />
            </linearGradient>}
            {paints.has('eye-white') && <radialGradient id={`${uid}-eye-white`} cx="40%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="55%" stopColor="#f3f4f8" />
                <stop offset="100%" stopColor="#b3b9c9" />
            </radialGradient>}
            {paints.has('pupil') && <radialGradient id={`${uid}-pupil`} cx="38%" cy="30%" r="80%">
                <stop offset="0%" stopColor="#4a4d60" />
                <stop offset="60%" stopColor="#17171d" />
                <stop offset="100%" stopColor="#050507" />
            </radialGradient>}
            {paints.has('glass') && <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b3e50" />
                <stop offset="50%" stopColor="#17181f" />
                <stop offset="100%" stopColor="#08080b" />
            </linearGradient>}
            {paints.has('lens') && <linearGradient id={`${uid}-lens`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0.02" />
            </linearGradient>}
            {paints.has('light') && <linearGradient id={`${uid}-visor-light`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" />
                <stop offset="100%" style={{ stopColor: light }} />
            </linearGradient>}
            {paints.has('heart') && <linearGradient id={`${uid}-heart`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffb3cb" />
                <stop offset="50%" stopColor={HEART} />
                <stop offset="100%" stopColor="#e0366f" />
            </linearGradient>}
            <filter id={`${uid}-eye-glow`} filterUnits="userSpaceOnUse" x={CENTER - 18} y={y - 12} width={36} height={24}>
                <feGaussianBlur stdDeviation="1.1" result="blur" />
                <feComponentTransfer in="blur" result="halo">
                    <feFuncA type="linear" slope="0.75" />
                </feComponentTransfer>
                <feMerge>
                    <feMergeNode in="halo" />
                    <feMergeNode in="SourceGraphic" />
                </feMerge>
            </filter>
        </defs>
    )
}

type EyesProps = { style: BuddyEyes; mood: BuddyMood; y: number; light: string; uid: string; lit: boolean }

function Eyes({ style, mood, y: baseY, light, uid, lit }: EyesProps) {
    const flat = !lit
    const P: Paints = flat
        ? { ink: INK, white: '#fff', pupil: DARK, glass: DARK, lens: 'rgb(255 255 255 / 0.08)', light, heart: HEART }
        : { ink: `url(#${uid}-ink)`, white: `url(#${uid}-eye-white)`, pupil: `url(#${uid}-pupil)`, glass: `url(#${uid}-glass)`, lens: `url(#${uid}-lens)`, light: `url(#${uid}-visor-light)`, heart: `url(#${uid}-heart)` }
    const solid = (shape: (paint: Paint, backing: boolean) => ReactNode) => <Solid uid={uid} lit={lit}>{shape}</Solid>
    const glint = (x: number, y: number, r = 0.62) => (lit ? <ellipse cx={x - 0.55} cy={y} rx={r} ry={r * 1.15} fill="#fff" fillOpacity={0.95} /> : null)

    if (mood === 'asleep') return solid(paint => <Pair y={baseY}>{({ x, y }) => closed(x, y, paint(P.ink))}</Pair>)
    if (mood === 'error' && style !== 'visor' && style !== 'shades' && style !== 'glasses') return solid(paint => <Pair y={baseY}>{({ x, y }) => cross(x, y, paint(P.ink))}</Pair>)

    const lookX = mood === 'working' ? 1 : 0
    const lookY = mood === 'waiting' ? -1.6 : mood === 'working' ? 1 : 0
    const y = baseY + lookY
    const at = (x: number) => x + lookX

    switch (style) {
        case 'pill':
            return (
                <g {...blinking(y)}>
                    {solid(paint => <Pair y={y}>{e => <ellipse cx={at(e.x)} cy={e.y} rx={1.9} ry={3.3} fill={paint(P.ink)} />}</Pair>)}
                    <Pair y={y}>{e => glint(at(e.x), e.y - 1.6)}</Pair>
                </g>
            )
        case 'round':
            return (
                <g {...blinking(y)}>
                    {solid(paint => <Pair y={y}>{e => <circle cx={at(e.x)} cy={e.y} r={2.3} fill={paint(P.ink)} />}</Pair>)}
                    <Pair y={y}>{e => glint(at(e.x), e.y - 0.9)}</Pair>
                </g>
            )
        case 'dot':
            return <g {...blinking(y)}>{solid(paint => <Pair y={y}>{e => <circle cx={at(e.x)} cy={e.y} r={1.25} fill={paint(P.ink)} />}</Pair>)}</g>
        case 'happy':
            return solid(paint => <Pair y={y}>{e => <path d={`M${at(e.x) - 2.6} ${e.y + 1} Q${at(e.x)} ${e.y - 2.6} ${at(e.x) + 2.6} ${e.y + 1}`} stroke={paint(P.ink)} strokeWidth={1.6} strokeLinecap="round" fill="none" />}</Pair>)
        case 'line':
            return solid(paint => <Pair y={y}>{e => <path d={`M${at(e.x) - 2.4} ${e.y} L${at(e.x) + 2.4} ${e.y}`} stroke={paint(P.ink)} strokeWidth={1.6} strokeLinecap="round" />}</Pair>)
        case 'googly':
            return (
                <g {...lids(y)}>
                    {solid(paint => <Pair y={y}>{e => <circle cx={e.x} cy={e.y} r={3.6} fill={paint(P.white)} />}</Pair>)}
                    <g className="iso-buddy-pupils">
                        <Pair y={y}>
                            {e => (
                                <>
                                    <circle cx={e.x + lookX * 0.8} cy={e.y + 0.6 + lookY * 0.6} r={1.7} fill={P.pupil} />
                                    {!flat && <circle cx={e.x - 0.6 + lookX * 0.8} cy={e.y + lookY * 0.6} r={0.55} fill="#fff" />}
                                </>
                            )}
                        </Pair>
                    </g>
                </g>
            )
        case 'cyclops':
            return (
                <g {...blinking(y)}>
                    {solid(paint => <circle cx={CENTER} cy={y} r={4.4} fill={paint(P.white)} />)}
                    <circle cx={CENTER + lookX} cy={y + 0.4 + lookY * 0.5} r={2.2} fill={P.pupil} />
                    <circle cx={CENTER - 0.8 + lookX} cy={y - 0.6} r={0.7} fill="#fff" />
                </g>
            )
        case 'visor':
            return (
                <g>
                    {solid((paint, backing) => <rect x={CENTER - 12} y={y - 3.6} width={24} height={7.2} rx={3.6} fill={paint(P.glass)} stroke={backing ? undefined : INK} strokeOpacity={0.3} strokeWidth={backing ? undefined : 0.6} />)}
                    {!flat && <path d={`M${CENTER - 9.5} ${y - 2.2} L${CENTER + 3} ${y - 2.2}`} stroke="#fff" strokeOpacity={0.22} strokeWidth={0.7} strokeLinecap="round" />}
                    {mood === 'error' ? (
                        <Pair y={y}>{e => cross(e.x, e.y, light)}</Pair>
                    ) : (
                        <g {...blinking(y)}><Pair y={y}>{e => <rect x={at(e.x) - 2.2} y={e.y - 1.2} width={4.4} height={2.4} rx={1.2} fill={P.light} />}</Pair></g>
                    )}
                </g>
            )
        case 'shades':
            return (
                <g>
                    <path d={`M${CENTER - 2} ${y - 1.6} L${CENTER + 2} ${y - 1.6}`} stroke={DARK} strokeWidth={1.2} />
                    {solid((paint, backing) => <Pair y={y}>{e => <rect x={e.x - 3.4} y={e.y - 2.6} width={6.8} height={5} rx={2} fill={paint(P.glass)} stroke={backing ? undefined : INK} strokeOpacity={0.45} strokeWidth={backing ? undefined : 0.6} />}</Pair>)}
                    <Pair y={y}>
                        {e =>
                            flat ? (
                                <path d={`M${e.x - 2.2} ${e.y - 1.2} L${e.x - 0.6} ${e.y - 1.2}`} stroke="#fff" strokeOpacity={0.55} strokeWidth={0.7} strokeLinecap="round" />
                            ) : (
                                <path d={`M${e.x - 2.4} ${e.y + 0.4} L${e.x - 0.2} ${e.y - 1.8}`} stroke="#fff" strokeOpacity={0.5} strokeWidth={0.8} strokeLinecap="round" />
                            )
                        }
                    </Pair>
                    {mood === 'error' && <path d={`M${CENTER - 3} ${y + 5} q3 -1.6 6 0`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" fill="none" />}
                </g>
            )
        case 'glasses':
            return (
                <g>
                    {solid((paint, backing) => (
                        <>
                            <path d={`M${CENTER - 1.4} ${y - 0.6} Q${CENTER} ${y - 1.6} ${CENTER + 1.4} ${y - 0.6}`} stroke={paint(P.ink)} strokeWidth={0.9} fill="none" />
                            <Pair y={y}>{e => <circle cx={e.x} cy={e.y} r={3.5} fill={backing ? 'none' : P.lens} stroke={paint(P.ink)} strokeWidth={0.9} />}</Pair>
                        </>
                    ))}
                    {mood === 'error' ? <Pair y={y}>{e => cross(e.x, e.y, P.ink)}</Pair> : <g {...blinking(y)}><Pair y={y}>{e => <circle cx={at(e.x)} cy={e.y + lookY * 0.3} r={1.2} fill={P.ink} />}</Pair></g>}
                </g>
            )
        case 'sleepy':
            return (
                <>
                    {solid(paint => <Pair y={y}>{e => <path d={`M${at(e.x) - 2.2} ${e.y - 0.6} L${at(e.x) + 2.2} ${e.y - 0.6} L${at(e.x) + 2.2} ${e.y + 1} A2.2 2.6 0 0 1 ${at(e.x) - 2.2} ${e.y + 1} Z`} fill={paint(P.ink)} />}</Pair>)}
                    <Pair y={y}>{e => glint(at(e.x), e.y + 0.4, 0.5)}</Pair>
                </>
            )
        case 'wink':
            return (
                <g>
                    {solid(paint => (
                        <>
                            <ellipse cx={at(CENTER - GAP)} cy={y} rx={1.9} ry={3.3} fill={paint(P.ink)} />
                            <path d={`M${at(CENTER + GAP) - 2.4} ${y} Q${at(CENTER + GAP)} ${y - 2.4} ${at(CENTER + GAP) + 2.4} ${y}`} stroke={paint(P.ink)} strokeWidth={1.5} strokeLinecap="round" fill="none" />
                        </>
                    ))}
                    {glint(at(CENTER - GAP), y - 1.6)}
                </g>
            )
        case 'pixel':
            return (
                <g {...blinking(y)}>
                    {solid(paint => <Pair y={y}>{e => <rect x={at(e.x) - 1.9} y={e.y - 2.4} width={3.8} height={4.8} rx={0.6} fill={paint(P.ink)} />}</Pair>)}
                    {lit && <Pair y={y}>{e => <rect x={at(e.x) - 1.3} y={e.y - 1.8} width={1.1} height={1.1} fill="#fff" />}</Pair>}
                </g>
            )
        case 'star':
            return solid(paint => <Pair y={y}>{e => <path d={star(at(e.x), e.y, 3.2)} fill={paint(P.ink)} />}</Pair>)
        case 'heart':
            return (
                <>
                    {solid(paint => (
                        <Pair y={y}>
                            {e => (
                                <path
                                    d={`M${at(e.x)} ${e.y + 2.6} C${at(e.x) - 4.2} ${e.y - 0.4} ${at(e.x) - 2.6} ${e.y - 3.6} ${at(e.x)} ${e.y - 1.4} C${at(e.x) + 2.6} ${e.y - 3.6} ${at(e.x) + 4.2} ${e.y - 0.4} ${at(e.x)} ${e.y + 2.6} Z`}
                                    fill={paint(P.heart)}
                                />
                            )}
                        </Pair>
                    ))}
                    {!flat && <Pair y={y}>{e => <ellipse cx={at(e.x) - 1.3} cy={e.y - 1.2} rx={0.6} ry={0.45} fill="#fff" fillOpacity={0.85} />}</Pair>}
                </>
            )
        case 'brows':
            return (
                <g>
                    {solid(paint => (
                        <>
                            <path d={`M${CENTER - GAP - 2.6} ${y - 5.2} L${CENTER - GAP + 2.2} ${y - 4}`} stroke={paint(P.ink)} strokeWidth={1.3} strokeLinecap="round" />
                            <path d={`M${CENTER + GAP + 2.6} ${y - 5.2} L${CENTER + GAP - 2.2} ${y - 4}`} stroke={paint(P.ink)} strokeWidth={1.3} strokeLinecap="round" />
                        </>
                    ))}
                    <g {...blinking(y)}>
                        {solid(paint => <Pair y={y}>{e => <ellipse cx={at(e.x)} cy={e.y + 0.4} rx={1.8} ry={2.6} fill={paint(P.ink)} />}</Pair>)}
                        <Pair y={y}>{e => glint(at(e.x), e.y - 0.8, 0.55)}</Pair>
                    </g>
                </g>
            )
        case 'sparkle':
            return (
                <g>
                    <g {...blinking(y)}>
                        {solid(paint => <Pair y={y}>{e => <ellipse cx={at(e.x)} cy={e.y} rx={2.2} ry={3.4} fill={paint(P.ink)} />}</Pair>)}
                        <Pair y={y}>{e => glint(at(e.x), e.y - 1.6, 0.7)}</Pair>
                    </g>
                    <path d={star(CENTER + GAP + 4.6, y - 4.2, 1.8)} fill={light} />
                </g>
            )
    }
}

function Mouth({ mouth, mood, y }: { mouth: BuddyMouth; mood: BuddyMood; y: number }) {
    if (mood === 'error') return <path d={`M${CENTER - 2.4} ${y + 0.8} Q${CENTER} ${y - 1.2} ${CENTER + 2.4} ${y + 0.8}`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" fill="none" />
    if (mood === 'waiting') return <ellipse cx={CENTER} cy={y} rx={1.3} ry={1.6} fill={INK} />
    switch (mouth) {
        case 'smile':
            return <path d={`M${CENTER - 2.4} ${y - 0.6} Q${CENTER} ${y + 1.8} ${CENTER + 2.4} ${y - 0.6}`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" fill="none" />
        case 'open':
            return <path d={`M${CENTER - 2} ${y - 0.8} Q${CENTER} ${y + 2.8} ${CENTER + 2} ${y - 0.8} Z`} fill={INK} />
        case 'cat':
            return <path d={`M${CENTER - 2.8} ${y - 0.4} Q${CENTER - 1.4} ${y + 1.6} ${CENTER} ${y - 0.4} Q${CENTER + 1.4} ${y + 1.6} ${CENTER + 2.8} ${y - 0.4}`} stroke={INK} strokeWidth={1.1} strokeLinecap="round" fill="none" />
        case 'flat':
            return <path d={`M${CENTER - 1.8} ${y} L${CENTER + 1.8} ${y}`} stroke={INK} strokeWidth={1.2} strokeLinecap="round" />
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
    tint: string
}

export function BuddyFace({ uid, eyes, mouth, mood, depth, light, lit, tint }: BuddyFaceProps) {
    const hasMouth = mouth !== 'none' || mood === 'error' || mood === 'waiting'
    const eyeY = depth * (hasMouth ? 0.38 : 0.45)
    return (
        <>
            {lit && <EyeDefs uid={uid} y={eyeY} tint={tint} light={light} paints={eyePaints(eyes, mood)} />}
            <Eyes style={eyes} mood={mood} y={eyeY} light={light} uid={uid} lit={lit} />
            {hasMouth && mood !== 'asleep' && <Mouth mouth={mouth} mood={mood} y={eyeY + 6.6} />}
        </>
    )
}
