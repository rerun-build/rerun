'use client'

import { useId, type ReactNode, type SVGProps } from 'react'

import { BACKDROPS, COLORS, EYE_COLORS, HATS, isTexture, VISORS, type BackdropSpec, type BodyShape, type Eyes, type Finish, type BuddyConfig, type Paint, type Shade, type Texture, type VisorShape } from './config'

// The Buddy drawn straight in the icon's 1024 box: a body (a sphere, or a shape of its own, or the
// whole icon) carrying the visor and its eyes, with what makes it ours around it, the hard hat, the
// board's lit tile, the orbit of its coworkers.

type Face = {
    eyes: Eyes
    // Radians: yaw > 0 turns the face to the right, pitch > 0 lifts it.
    yaw?: number
    pitch?: number
    roll?: number
    size?: number
    visor: [top: string, bottom: string]
    visorShape: VisorShape
    // The board's 2:1 lines reflected in the visor.
    grid: boolean
    eye: string
    shine: number
}

type Pose = Pick<Face, 'yaw' | 'pitch' | 'roll'> & { size: number }

type Surface = { paint: Paint; finish: Finish; texture: number }

const CUBES = {
    pink: ['#ff8fc8', '#f0127f', '#9c0a52'],
    emerald: ['#7ff0b8', '#00b862', '#006b39'],
    amber: ['#ffe08a', '#ffb21a', '#b86e00'],
} satisfies Record<string, Shade>

const LAVENDER = '#b7a8ff'

// Each body in units where a sphere's radius is 100, centred on (0, 0).
const BODY_PATH: Record<BodyShape, string> = {
    sphere: 'M-100 0 A100 100 0 1 0 100 0 A100 100 0 1 0 -100 0 Z',
    pebble: 'M-128 0 A128 94 0 1 0 128 0 A128 94 0 1 0 -128 0 Z',
    bean: 'M-80 -45 A80 80 0 0 1 80 -45 V45 A80 80 0 0 1 -80 45 Z',
    drop: 'M0 -170 C34 -120 100 -62 100 8 A100 100 0 0 1 -100 8 C-100 -62 -34 -120 0 -170 Z',
}

function useUid() {
    return useId().replace(/[^a-zA-Z0-9]/g, '')
}

function Svg({ children }: { children: ReactNode }) {
    return (
        <svg viewBox="0 0 1024 1024" className="block size-full" aria-hidden>
            {children}
        </svg>
    )
}

function Backdrop({ uid, from, to, radial = false }: BackdropSpec & { uid: string }) {
    if (!to) return <rect width="1024" height="1024" fill={from} />
    return (
        <>
            <defs>
                {radial ? (
                    <radialGradient id={`${uid}-bg`} cx="35%" cy="25%" r="90%">
                        <stop offset="0%" stopColor={from} />
                        <stop offset="100%" stopColor={to} />
                    </radialGradient>
                ) : (
                    <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.4" y2="1">
                        <stop offset="0%" stopColor={from} />
                        <stop offset="100%" stopColor={to} />
                    </linearGradient>
                )}
            </defs>
            <rect width="1024" height="1024" fill={`url(#${uid}-bg)`} />
        </>
    )
}

type TextureSpec = {
    // How far noise pushes the silhouette out, and the size of that noise.
    fray: number
    warp: number
    // The relief pressed into the surface: its noise, how deep it reads, and how much of the colour it takes.
    bump: { type: 'fractalNoise' | 'turbulence'; frequency: number; octaves: number; depth: number; strength: number }
    pits?: boolean
    sparkle?: boolean
}

// In the icon's 1024 units.
const TEXTURES: Record<Texture, TextureSpec> = {
    fur: { fray: 16, warp: 0.3, bump: { type: 'fractalNoise', frequency: 0.11, octaves: 4, depth: 4, strength: 0.6 } },
    shag: { fray: 40, warp: 0.16, bump: { type: 'fractalNoise', frequency: 0.07, octaves: 4, depth: 6, strength: 0.65 } },
    felt: { fray: 3, warp: 0.6, bump: { type: 'fractalNoise', frequency: 0.3, octaves: 3, depth: 3, strength: 0.55 } },
    boucle: { fray: 12, warp: 0.25, bump: { type: 'turbulence', frequency: 0.075, octaves: 2, depth: 5, strength: 0.6 } },
    sponge: { fray: 2, warp: 0.5, bump: { type: 'fractalNoise', frequency: 0.03, octaves: 2, depth: 3, strength: 0.5 }, pits: true },
    moss: { fray: 6, warp: 0.5, bump: { type: 'fractalNoise', frequency: 0.045, octaves: 3, depth: 4, strength: 0.55 } },
    sugar: { fray: 5, warp: 0.5, bump: { type: 'fractalNoise', frequency: 0.9, octaves: 1, depth: 2, strength: 0.5 }, sparkle: true },
    velvet: { fray: 2, warp: 0.5, bump: { type: 'fractalNoise', frequency: 0.7, octaves: 2, depth: 1.5, strength: 0.55 } },
}

// A flat surface under this light comes out of the relief at sin(55°): what keeps the colour's
// average where it was, whatever the strength.
const FLAT_LIGHT = 0.82

// The silhouette frayed by noise, then a lit relief multiplied into the colour, with pits or sparkles on
// top. `unit` is how many of the icon's 1024 units one of the filtered element's own units spans, and
// `amount` scales the whole texture, 1 being its tuned look.
function TextureFilter({ id, texture, amount, unit = 1, frayShare = 1 }: { id: string; texture: Texture; amount: number; unit?: number; frayShare?: number }) {
    const spec = TEXTURES[texture]
    const { bump } = spec
    const strength = Math.min(1.2, bump.strength * amount)
    return (
        <filter id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={spec.warp * unit} numOctaves="3" seed="7" result="warp" />
            <feDisplacementMap in="SourceGraphic" in2="warp" scale={(spec.fray * frayShare * amount) / unit} xChannelSelector="R" yChannelSelector="G" result="frayed" />
            <feTurbulence type={bump.type} baseFrequency={bump.frequency * unit} numOctaves={bump.octaves} seed="3" result="relief" />
            <feDiffuseLighting in="relief" surfaceScale={bump.depth * amount} diffuseConstant="1" lightingColor="#ffffff" result="bump">
                <feDistantLight azimuth="225" elevation="55" />
            </feDiffuseLighting>
            <feComposite in="bump" in2="frayed" operator="arithmetic" k1={strength} k2="0" k3={1.14 - FLAT_LIGHT * strength} k4="0" result="lit" />
            {spec.pits && (
                <>
                    <feTurbulence type="fractalNoise" baseFrequency={0.07 * unit} numOctaves="2" seed="11" result="pitNoise" />
                    <feColorMatrix in="pitNoise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -14 0 0 0 6.2" result="pitShape" />
                    <feGaussianBlur in="pitShape" stdDeviation={2 / unit} result="pitSoft" />
                    <feColorMatrix in="pitSoft" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${0.3 * amount} 0`} result="pitMask" />
                    <feComposite in="pitMask" in2="frayed" operator="in" result="pits" />
                    <feMerge>
                        <feMergeNode in="lit" />
                        <feMergeNode in="pits" />
                    </feMerge>
                </>
            )}
            {spec.sparkle && (
                <>
                    <feSpecularLighting in="relief" surfaceScale="5" specularConstant="1.2" specularExponent="16" lightingColor="#ffffff" result="glint">
                        <feDistantLight azimuth="225" elevation="40" />
                    </feSpecularLighting>
                    <feComposite in="glint" in2="frayed" operator="in" result="glintIn" />
                    <feComposite in="lit" in2="glintIn" operator="arithmetic" k1="0" k2="1" k3={0.7 * amount} k4="0" />
                </>
            )}
        </filter>
    )
}

function eyeShape(eyes: Eyes, x: number) {
    if (eyes === 'round') return { kind: 'circle' as const, cx: x, cy: 0, r: 9 }
    if (eyes === 'diamond') return { kind: 'path' as const, d: `M${x} -12 L${x + 12} 0 L${x} 12 L${x - 12} 0 Z` }
    const w = 11
    const h = 23
    return { kind: 'rect' as const, x: x - w / 2, y: -h / 2, width: w, height: h, rx: w / 2 }
}

function Shape({ shape, ...rest }: { shape: ReturnType<typeof eyeShape> } & SVGProps<SVGElement>) {
    if (shape.kind === 'circle') return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...(rest as SVGProps<SVGCircleElement>)} />
    if (shape.kind === 'path') return <path d={shape.d} strokeLinejoin="round" {...(rest as SVGProps<SVGPathElement>)} />
    return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} {...(rest as SVGProps<SVGRectElement>)} />
}

const VISOR_PATH: Record<VisorShape, string> = {
    pill: 'M-23 -25 H23 A25 25 0 0 1 23 25 H-23 A25 25 0 0 1 -23 -25 Z',
    hex: 'M-50 0 L-30 -25 H30 L50 0 L30 25 H-30 Z',
}

function GlowingEyes({ uid, face, xs, flat }: { uid: string; face: Face; xs: number[]; flat?: boolean }) {
    return (
        <>
            {(flat ? [false] : [true, false]).map(glow => (
                <g key={String(glow)} filter={glow ? `url(#${uid}-eyeglow)` : undefined} opacity={glow ? 0.9 : 1}>
                    {face.eyes === 'happy' ? xs.map(x => <path key={x} d={`M${x - 9} 5 Q${x} -9 ${x + 9} 5`} fill="none" stroke={face.eye} strokeWidth={7} strokeLinecap="round" />) : xs.map(x => <Shape key={x} shape={eyeShape(face.eyes, x)} fill={face.eye} stroke={face.eyes === 'diamond' ? face.eye : undefined} strokeWidth={3} />)}
                </g>
            ))}
        </>
    )
}

// Drawn in units where the sphere's radius is 100, centred on the face.
function FaceArt({ uid, face, flat = false }: { uid: string; face: Face; flat?: boolean }) {
    const [visorTop, visorBottom] = face.visor
    const visorPath = VISOR_PATH[face.visorShape]
    return (
        <>
            <defs>
                <linearGradient id={`${uid}-visor`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={visorTop} />
                    <stop offset="100%" stopColor={visorBottom} />
                </linearGradient>
                <clipPath id={`${uid}-visorclip`}>
                    <path d={visorPath} />
                </clipPath>
                <filter id={`${uid}-eyeglow`} x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur stdDeviation="3.5" />
                </filter>
            </defs>
            {!flat && <path d={visorPath} transform="translate(0 2.4)" fill="#ffffff" fillOpacity={0.5} strokeLinejoin="round" />}
            <path d={visorPath} fill={`url(#${uid}-visor)`} stroke={face.visorShape === 'hex' ? `url(#${uid}-visor)` : undefined} strokeWidth={6} strokeLinejoin="round" />
            {face.grid && (
                <g clipPath={`url(#${uid}-visorclip)`} stroke={LAVENDER} strokeOpacity={0.22} strokeWidth={0.8}>
                    {Array.from({ length: 13 }, (_, i) => (i - 6) * 14).map(c => (
                        <g key={c}>
                            <line x1={-60} y1={c - 30} x2={60} y2={c + 30} />
                            <line x1={-60} y1={c + 30} x2={60} y2={c - 30} />
                        </g>
                    ))}
                </g>
            )}
            {!flat && face.shine > 0 && <rect x={-39} y={-21} width={78} height={18} rx={9} fill="#ffffff" fillOpacity={0.09 * face.shine} clipPath={`url(#${uid}-visorclip)`} />}
            <GlowingEyes uid={uid} face={face} xs={[-19, 19]} flat={flat} />
        </>
    )
}

function faceTransform(face: Face) {
    const yaw = face.yaw ?? 0
    const pitch = face.pitch ?? 0
    const x = 100 * Math.sin(yaw) * Math.cos(pitch)
    const y = -100 * Math.sin(pitch)
    const k = face.size ?? 1
    return `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${face.roll ?? 0}) scale(${(k * Math.cos(yaw)).toFixed(3)} ${(k * Math.cos(pitch)).toFixed(3)})`
}

type BodyProps = Surface & {
    cx: number
    cy: number
    r: number
    face: Face
    shape?: BodyShape
    shadow?: number
    // Drawn in the body's own units, behind it, over it but clipped to it, and over everything.
    behind?: ReactNode
    clipped?: ReactNode
    over?: ReactNode
}

function Body({ cx, cy, r, paint, finish, texture, face, shape = 'sphere', shadow = 0, behind, clipped, over }: BodyProps) {
    const uid = useUid()
    const gloss = finish === 'gloss'
    const flat = finish === 'flat'
    const textured = isTexture(finish)
    const path = BODY_PATH[shape]
    const faceGroup = (
        <g transform={faceTransform(face)}>
            <FaceArt uid={uid} face={face} flat={flat} />
        </g>
    )
    return (
        <g transform={`translate(${cx} ${cy}) scale(${r / 100})`}>
            <defs>
                <radialGradient id={`${uid}-body`} cx={-38} cy={-45} r={170} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor={paint.hi} />
                    <stop offset="30%" stopColor={paint.base} />
                    <stop offset="78%" stopColor={paint.low} />
                    <stop offset="100%" stopColor={paint.low} />
                </radialGradient>
                <radialGradient id={`${uid}-rim`} cx={-22} cy={-28} r={132} gradientUnits="userSpaceOnUse">
                    <stop offset="80%" stopColor={paint.rim} stopOpacity={0} />
                    <stop offset="100%" stopColor={paint.rim} stopOpacity={gloss ? 0.75 : finish === 'velvet' ? 0.95 : 0.45} />
                </radialGradient>
                <linearGradient id={`${uid}-spec`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fff" stopOpacity={gloss ? 0.95 : 0.4} />
                    <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                </linearGradient>
                <clipPath id={`${uid}-clip`}>
                    <path d={path} />
                </clipPath>
                <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation={6} />
                </filter>
                <filter id={`${uid}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation={12} />
                </filter>
                {isTexture(finish) && <TextureFilter id={`${uid}-fur`} texture={finish} amount={texture} unit={r / 100} />}
            </defs>
            {shadow > 0 && <path d={path} transform="translate(8 14)" fill="#000" opacity={shadow} filter={`url(#${uid}-shadow)`} />}
            {behind}
            <g filter={textured ? `url(#${uid}-fur)` : undefined}>
                <g clipPath={`url(#${uid}-clip)`}>
                    <path d={path} fill={flat ? paint.base : `url(#${uid}-body)`} />
                    {!flat && <path d={path} fill={`url(#${uid}-rim)`} />}
                    {!textured && faceGroup}
                    {clipped}
                    {!flat && <ellipse cx={-46} cy={-60} rx={28} ry={13} transform="rotate(-36 -46 -60)" fill={`url(#${uid}-spec)`} filter={gloss ? undefined : `url(#${uid}-soft)`} />}
                </g>
            </g>
            {textured && <g clipPath={`url(#${uid}-clip)`}>{faceGroup}</g>}
            {over}
        </g>
    )
}

type Scene = { backdrop: BackdropSpec; behindScene?: ReactNode; overScene?: ReactNode }

function BodyIcon({ backdrop, behindScene, overScene, ...body }: BodyProps & Scene) {
    const uid = useUid()
    return (
        <Svg>
            <Backdrop uid={uid} {...backdrop} />
            {behindScene}
            <Body {...body} />
            {overScene}
        </Svg>
    )
}

// The whole icon is the Buddy's body: a pillow lit from the top left, the visor in the middle.
function Pillow({ paint, finish, texture, face, faceY = 530 }: Surface & { face: Face; faceY?: number }) {
    const uid = useUid()
    const textured = isTexture(finish)
    return (
        <>
            <defs>
                <radialGradient id={`${uid}-face`} cx="32%" cy="22%" r="85%">
                    <stop offset="0%" stopColor={finish === 'flat' ? paint.base : paint.hi} />
                    <stop offset="45%" stopColor={paint.base} />
                    <stop offset="100%" stopColor={paint.base} />
                </radialGradient>
                <filter id={`${uid}-pillow`} x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="46" />
                </filter>
                <filter id={`${uid}-soft`} x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="34" />
                </filter>
                {isTexture(finish) && <TextureFilter id={`${uid}-fur`} texture={finish} amount={texture} frayShare={0.5} />}
            </defs>
            <g filter={textured ? `url(#${uid}-fur)` : undefined}>
                <rect x="-40" y="-40" width="1104" height="1104" fill={finish === 'flat' ? paint.base : paint.low} />
                {finish !== 'flat' && (
                    <>
                        <rect x="70" y="56" width="884" height="860" rx="250" fill={`url(#${uid}-face)`} filter={`url(#${uid}-pillow)`} />
                        <ellipse cx="512" cy="1000" rx="380" ry="70" fill={paint.rim} opacity={0.5} filter={`url(#${uid}-soft)`} />
                        <ellipse cx="410" cy="170" rx="280" ry="80" fill="#fff" opacity={finish === 'gloss' ? 0.45 : 0.22} filter={`url(#${uid}-soft)`} />
                    </>
                )}
            </g>
            <g transform={`translate(512 ${faceY - (face.pitch ?? 0) * 200}) rotate(${face.roll ?? 0}) scale(${4.6 * (face.size ?? 1)})`}>
                <FaceArt uid={uid} face={face} flat={finish === 'flat'} />
            </g>
        </>
    )
}

// A construction hard hat sitting on a sphere, in the sphere's units.
function HardHat({ shade, lamp = false, tilt = 0 }: { shade: Shade; lamp?: boolean; tilt?: number }) {
    const uid = useUid()
    const [hi, base, low] = shade
    return (
        <g transform={`rotate(${tilt} 0 -40)`}>
            <defs>
                <radialGradient id={`${uid}-dome`} cx={-34} cy={-118} r={130} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor={hi} />
                    <stop offset="45%" stopColor={base} />
                    <stop offset="100%" stopColor={low} />
                </radialGradient>
                <linearGradient id={`${uid}-brim`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={hi} />
                    <stop offset="55%" stopColor={base} />
                    <stop offset="100%" stopColor={low} />
                </linearGradient>
                <filter id={`${uid}-lamp`} x="-200%" y="-200%" width="500%" height="500%">
                    <feGaussianBlur stdDeviation={9} />
                </filter>
            </defs>
            <ellipse cx={0} cy={-44} rx={116} ry={22} fill={`url(#${uid}-brim)`} />
            <path d="M-84 -50 C-86 -152 86 -152 84 -50 Q0 -36 -84 -50 Z" fill={`url(#${uid}-dome)`} />
            <path d="M-13 -126 Q-16 -86 -17 -45 Q0 -42 17 -45 Q16 -86 13 -126 Q0 -129 -13 -126 Z" fill={hi} opacity={0.55} />
            <path d="M-84 -50 Q0 -36 84 -50" fill="none" stroke={low} strokeWidth={3} strokeOpacity={0.5} />
            {lamp && (
                <>
                    <circle cx={0} cy={-84} r={26} fill="#fff6c8" filter={`url(#${uid}-lamp)`} />
                    <rect x={-16} y={-98} width={32} height={26} rx={9} fill="#2a2a33" />
                    <circle cx={0} cy={-85} r={9.5} fill="#fffbe6" />
                </>
            )}
        </g>
    )
}

// The brim's shadow on the sphere, under the hat.
function BrimShadow({ tilt = 0 }: { tilt?: number }) {
    const uid = useUid()
    return (
        <>
            <defs>
                <filter id={`${uid}-brim`} x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation={7} />
                </filter>
            </defs>
            <ellipse cx={0} cy={-26} rx={108} ry={26} transform={`rotate(${tilt} 0 -40)`} fill="#000" opacity={0.38} filter={`url(#${uid}-brim)`} />
        </>
    )
}

// The whole icon is the body and its top third the hat.
function HatPillowIcon({ shade, face, ...surface }: Surface & { shade: Shade; face: Face }) {
    const uid = useUid()
    const [hi, base, low] = shade
    return (
        <Svg>
            <defs>
                <radialGradient id={`${uid}-dome`} cx="30%" cy="10%" r="80%">
                    <stop offset="0%" stopColor={hi} />
                    <stop offset="50%" stopColor={base} />
                    <stop offset="100%" stopColor={low} />
                </radialGradient>
                <linearGradient id={`${uid}-brim`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={hi} />
                    <stop offset="60%" stopColor={base} />
                    <stop offset="100%" stopColor={low} />
                </linearGradient>
                <filter id={`${uid}-shade`} x="-20%" y="-50%" width="140%" height="200%">
                    <feGaussianBlur stdDeviation="24" />
                </filter>
            </defs>
            <Pillow {...surface} face={face} faceY={660} />
            <path d="M-40 -40 H1064 V380 Q512 470 -40 380 Z" fill={`url(#${uid}-dome)`} />
            <path d="M440 -40 Q430 200 424 420 Q512 428 600 420 Q594 200 584 -40 Z" fill={hi} opacity={0.45} />
            <path d="M-40 420 Q512 520 1064 420 V470 Q512 570 -40 470 Z" fill="#000" opacity={0.45} filter={`url(#${uid}-shade)`} />
            <path d="M-40 370 Q512 460 1064 370 V430 Q512 530 -40 430 Z" fill={`url(#${uid}-brim)`} />
        </Svg>
    )
}

// The lit tile of the board, its four walls of light on the diamond's edges.
function litTile({ uid, cx, cy, halfW, height, color }: { uid: string; cx: number; cy: number; halfW: number; height: number; color: string }) {
    const halfH = halfW / 2
    const top = [cx, cy - halfH]
    const right = [cx + halfW, cy]
    const bottom = [cx, cy + halfH]
    const left = [cx - halfW, cy]
    const wall = ([x1, y1]: number[], [x2, y2]: number[]) => `M${x1} ${y1} L${x2} ${y2} L${x2} ${y2 - height} L${x1} ${y1 - height} Z`
    return {
        back: (
            <>
                <defs>
                    <linearGradient id={`${uid}-wall`} x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                    <filter id={`${uid}-shadow`} x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="18" />
                    </filter>
                </defs>
                <path d={`M${top} L${right} L${bottom} L${left} Z`} fill={color} fillOpacity={0.16} />
                <path d={wall(left, top)} fill={`url(#${uid}-wall)`} />
                <path d={wall(top, right)} fill={`url(#${uid}-wall)`} />
                <ellipse cx={cx} cy={cy} rx={halfW * 0.55} ry={halfH * 0.4} fill="#000" opacity={0.45} filter={`url(#${uid}-shadow)`} />
            </>
        ),
        front: (
            <>
                <path d={wall(left, bottom)} fill={`url(#${uid}-wall)`} />
                <path d={wall(bottom, right)} fill={`url(#${uid}-wall)`} />
            </>
        ),
    }
}

function TileIcon({ color, ...body }: Omit<BodyProps, 'cx' | 'cy' | 'r'> & { backdrop: BackdropSpec; color: string }) {
    const tile = litTile({ uid: useUid(), cx: 512, cy: 760, halfW: 330, height: 120, color })
    return <BodyIcon {...body} behindScene={tile.back} overScene={tile.front} cx={512} cy={540} r={220} />
}

const RING = { rx: 172, ry: 40, tilt: -14 }

function ringPoint(t: number) {
    const x = RING.rx * Math.cos(t)
    const y = RING.ry * Math.sin(t)
    const a = (RING.tilt * Math.PI) / 180
    return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) }
}

function IsoCube({ x, y, s, shade }: { x: number; y: number; s: number; shade: Shade }) {
    const [hi, base, low] = shade
    return (
        <g>
            <path d={`M${x} ${y - s} L${x + s} ${y - s / 2} L${x} ${y} L${x - s} ${y - s / 2} Z`} fill={hi} />
            <path d={`M${x - s} ${y - s / 2} L${x} ${y} L${x} ${y + s} L${x - s} ${y + s / 2} Z`} fill={base} />
            <path d={`M${x} ${y} L${x + s} ${y - s / 2} L${x + s} ${y + s / 2} L${x} ${y + s} Z`} fill={low} />
        </g>
    )
}

const TEAM = [
    { t: 2.5, shade: CUBES.pink },
    { t: 1.1, shade: CUBES.emerald },
    { t: -0.45, shade: CUBES.amber },
]

// A ring around the body, its back half hidden by it; coworkers riding on it as little cubes.
function orbit({ color, cubes = [] }: { color: string; cubes?: { t: number; shade: Shade }[] }) {
    const half = (front: boolean) => {
        const id = `orbit-${front ? 'front' : 'back'}-${color.slice(1)}`
        return (
            <g transform={`rotate(${RING.tilt})`}>
                <defs>
                    <clipPath id={id}>
                        <rect x={-220} y={front ? 0 : -80} width={440} height={80} />
                    </clipPath>
                </defs>
                <ellipse rx={RING.rx} ry={RING.ry} fill="none" stroke={color} strokeWidth={9} clipPath={`url(#${id})`} opacity={front ? 1 : 0.7} />
            </g>
        )
    }
    const riders = (front: boolean) =>
        cubes
            .filter(({ t }) => Math.sin(t) > 0 === front)
            .map(({ t, shade }) => {
                const p = ringPoint(t)
                return <IsoCube key={t} x={p.x} y={p.y} s={27} shade={shade} />
            })
    return {
        behind: (
            <>
                {half(false)}
                {riders(false)}
            </>
        ),
        over: (
            <>
                {half(true)}
                {riders(true)}
            </>
        ),
    }
}

// An antenna bent into the re-run loop: a circle that comes back on itself, with its arrowhead.
function LoopAntenna({ color, stalk }: { color: string; stalk: string }) {
    const uid = useUid()
    const r = 24
    const cy = -152
    const start = (-60 * Math.PI) / 180
    const end = (230 * Math.PI) / 180
    const point = (a: number) => [r * Math.cos(a), cy + r * Math.sin(a)]
    const [sx, sy] = point(start)
    const [ex, ey] = point(end)
    const tangent = end + Math.PI / 2
    const head = [
        [ex + 13 * Math.cos(tangent), ey + 13 * Math.sin(tangent)],
        [ex + 11 * Math.cos(end), ey + 11 * Math.sin(end)],
        [ex - 11 * Math.cos(end), ey - 11 * Math.sin(end)],
    ]
    return (
        <g>
            <defs>
                <filter id={`${uid}-glow`} x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur stdDeviation={5} />
                </filter>
            </defs>
            <path d="M0 -98 L0 -124" stroke={stalk} strokeWidth={7} strokeLinecap="round" />
            <circle cx={0} cy={-100} r={9} fill={stalk} />
            {[true, false].map(glow => (
                <g key={String(glow)} filter={glow ? `url(#${uid}-glow)` : undefined}>
                    <path d={`M${sx} ${sy} A${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
                    <path d={`M${head.map(p => p.join(' ')).join(' L')} Z`} fill={color} stroke={color} strokeWidth={3} strokeLinejoin="round" />
                </g>
            ))}
        </g>
    )
}

const CENTRED_POSE: Pose = { yaw: -0.18, pitch: 0.06, roll: -6, size: 1.1 }

// Where each body sits when centred, and how its face turns on it.
const CENTRED_SPOT: Record<BodyShape, { cx: number; cy: number; r: number; pose: Pose }> = {
    sphere: { cx: 512, cy: 530, r: 320, pose: CENTRED_POSE },
    pebble: { cx: 512, cy: 540, r: 300, pose: { ...CENTRED_POSE, roll: -4 } },
    bean: { cx: 512, cy: 520, r: 290, pose: { ...CENTRED_POSE, pitch: 0.25 } },
    drop: { cx: 512, cy: 600, r: 290, pose: { ...CENTRED_POSE, pitch: -0.05 } },
}

// Rising from the bottom edge, high enough to read round, the face turned up towards whoever holds the phone.
const RISING = { cx: 512, cy: 880, r: 600, pose: { pitch: 0.5, size: 0.95 } }
const HAT = { cx: 512, cy: 600, r: 300, pose: { yaw: -0.12, pitch: -0.18, roll: -4, size: 1.05 } }
const HAT_TILT = -14
const ORBIT = { cx: 512, cy: 520, r: 260 }
const ANTENNA = { cx: 512, cy: 600, r: 300 }
const DARKEST_BACKDROPS = ['ink', 'black']

export function BuddyArt({ config }: { config: BuddyConfig }) {
    const surface: Surface = { paint: COLORS[config.color], finish: config.finish, texture: config.texture }
    const backdrop = BACKDROPS[config.backdrop]
    const darkest = DARKEST_BACKDROPS.includes(config.backdrop)
    const shadow = config.finish === 'flat' ? 0 : darkest ? 0.5 : backdrop.dark ? 0.3 : 0.2
    const accent = darkest ? LAVENDER : '#ffffff'
    const face = (pose: Pose): Face => ({
        ...pose,
        size: pose.size * config.visorSize,
        eyes: config.eyes,
        visor: VISORS[config.visor],
        visorShape: config.visorShape,
        grid: config.grid,
        eye: EYE_COLORS[config.eye],
        shine: config.shine,
    })
    const scene = { ...surface, backdrop, shadow }

    switch (config.framing) {
        case 'rising':
            return <BodyIcon {...scene} {...RISING} face={face(RISING.pose)} />
        case 'centred': {
            const spot = CENTRED_SPOT[config.shape]
            return <BodyIcon {...scene} {...spot} shape={config.shape} face={face(spot.pose)} />
        }
        case 'hat': {
            const tilt = config.tilt ? HAT_TILT : 0
            const pose = config.tilt ? { ...HAT.pose, roll: -12 } : HAT.pose
            return <BodyIcon {...scene} {...HAT} face={face(pose)} clipped={<BrimShadow tilt={tilt} />} over={<HardHat shade={HATS[config.hat]} lamp={config.lamp} tilt={tilt} />} />
        }
        case 'hatFace':
            return <HatPillowIcon {...surface} shade={HATS[config.hat]} face={face({ size: 1 })} />
        case 'wholeFace':
            return (
                <Svg>
                    <Pillow {...surface} face={face({ size: 1 })} />
                </Svg>
            )
        case 'orbit':
            return <BodyIcon {...scene} {...ORBIT} shadow={0} face={face(CENTRED_POSE)} {...orbit({ color: accent, cubes: config.team ? TEAM : [] })} />
        case 'tile':
            return <TileIcon {...scene} shadow={0} face={face({ ...CENTRED_POSE, size: 1.05 })} color={accent} />
        case 'antenna':
            return <BodyIcon {...scene} {...ANTENNA} face={face(CENTRED_POSE)} over={<LoopAntenna color={accent} stalk={surface.paint.low} />} />
    }
}

export type BuddyPose = Pose

// The Buddy on its own, without the icon's backdrop, for a scene that brings its own ground. Its fur
// frays past the body, hence the margin around it and the visible overflow.
export function BuddyFigure({ config, pose = CENTRED_POSE }: { config: BuddyConfig; pose?: BuddyPose }) {
    const hat = config.framing === 'hat'
    const face: Face = { ...pose, size: pose.size * config.visorSize, eyes: config.eyes, visor: VISORS[config.visor], visorShape: config.visorShape, grid: config.grid, eye: EYE_COLORS[config.eye], shine: config.shine }
    return (
        <svg viewBox="0 0 1024 1024" className="block size-full overflow-visible" aria-hidden>
            <Body paint={COLORS[config.color]} finish={config.finish} texture={config.texture} face={face} shape={config.shape} cx={512} cy={hat ? 560 : 512} r={hat ? 380 : 420} clipped={hat ? <BrimShadow /> : undefined} over={hat ? <HardHat shade={HATS[config.hat]} lamp={config.lamp} /> : undefined} />
        </svg>
    )
}
