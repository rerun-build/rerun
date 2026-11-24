// What the Buddy art can be told: its framing, body, finish and face, and the palettes behind each.
// The app-icon lab of Rerun Cloud explores every combination; BRAND_BUDDY is the one Rerun ships.

export type Framing = 'rising' | 'centred' | 'hat' | 'hatFace' | 'wholeFace' | 'orbit' | 'tile' | 'antenna'
export type BodyShape = 'sphere' | 'pebble' | 'bean' | 'drop'
export type Eyes = 'pill' | 'round' | 'happy' | 'diamond'
export type VisorShape = 'pill' | 'hex'
export type Texture = 'fur' | 'shag' | 'felt' | 'boucle' | 'sponge' | 'moss' | 'sugar' | 'velvet'
export type Finish = 'gloss' | 'matte' | 'flat' | Texture

export type Paint = { hi: string; base: string; low: string; rim: string }
export type Shade = [hi: string, base: string, low: string]
export type BackdropSpec = { from: string; to?: string; radial?: boolean; dark: boolean }

export const COLORS = {
    indigo: { hi: '#e3deff', base: '#4d34f7', low: '#170c6e', rim: '#9d8eff' },
    violet: { hi: '#9c8dff', base: '#5a43f5', low: '#2a1aa8', rim: '#b1a6ff' },
    deep: { hi: '#7a68ff', base: '#3a22d9', low: '#0e0750', rim: '#c7bdff' },
    lavender: { hi: '#ffffff', base: '#c6bbff', low: '#5f4ce6', rim: '#ffffff' },
    white: { hi: '#ffffff', base: '#ecebf2', low: '#8d8e9c', rim: '#ffffff' },
    cream: { hi: '#ffffff', base: '#f6efe4', low: '#b9a88f', rim: '#ffffff' },
    ink: { hi: '#55556a', base: '#1d1d26', low: '#050507', rim: '#6a5cff' },
    lime: { hi: '#f7ffc4', base: '#c8f53a', low: '#5f8f00', rim: '#efffa0' },
    yellow: { hi: '#fff6b8', base: '#ffc81f', low: '#e07f00', rim: '#fff0a0' },
    orange: { hi: '#ffb27a', base: '#ff6418', low: '#b83400', rim: '#ff9a5a' },
    coral: { hi: '#ffd2c8', base: '#ff6f5e', low: '#c22a3a', rim: '#ffb3a6' },
    pink: { hi: '#ffd6ec', base: '#ff7ac0', low: '#c21f78', rim: '#ffc2e2' },
    sunset: { hi: '#ffd6f0', base: '#e2389f', low: '#3b1fd6', rim: '#ff9ad5' },
} satisfies Record<string, Paint>

export const BACKDROPS = {
    ink: { from: '#1c1b24', to: '#050507', radial: true, dark: true },
    black: { from: '#000000', dark: true },
    indigo: { from: '#7a66ff', to: '#2a17c9', dark: true },
    brand: { from: '#4d34f7', dark: true },
    blue: { from: '#5ab4ff', to: '#2350f0', dark: true },
    studio: { from: '#ececee', to: '#cfcfd4', dark: false },
    lilac: { from: '#efeaff', to: '#c9bdff', dark: false },
    cream: { from: '#fdf6ee', to: '#f0dfcb', dark: false },
    mint: { from: '#e2fff0', to: '#8fe8bf', dark: false },
    lime: { from: '#e6ff8a', to: '#a6dd12', dark: false },
    sun: { from: '#ffd84a', to: '#ff9f0a', dark: false },
    coral: { from: '#ff9a8a', to: '#e8424f', dark: true },
} satisfies Record<string, BackdropSpec>

export const VISORS = {
    dark: ['#24263a', '#05060c'],
    indigo: ['#5a43f5', '#2a1aa8'],
    blue: ['#2a4bff', '#0d1a8a'],
    black: ['#000000', '#000000'],
    night: ['#1a1240', '#1a1240'],
    brand: ['#4d34f7', '#4d34f7'],
} satisfies Record<string, [top: string, bottom: string]>

export const EYE_COLORS = {
    lavender: '#cfc6ff',
    white: '#ffffff',
    lime: '#e9ff9a',
    butter: '#fff3b0',
    peach: '#ffd2c8',
    mint: '#b8ffe0',
} satisfies Record<string, string>

export const HATS = {
    yellow: ['#fff3a6', '#ffc21a', '#c97400'],
    indigo: ['#b3a6ff', '#4d34f7', '#1d1090'],
    white: ['#ffffff', '#eceaf4', '#8f8da3'],
    lime: ['#f4ffb0', '#c6f432', '#5f8f00'],
} satisfies Record<string, Shade>

export type ColorKey = keyof typeof COLORS
export type BackdropKey = keyof typeof BACKDROPS
export type VisorKey = keyof typeof VISORS
export type EyeKey = keyof typeof EYE_COLORS
export type HatKey = keyof typeof HATS

export type BuddyConfig = {
    framing: Framing
    shape: BodyShape
    color: ColorKey
    finish: Finish
    // How strongly a texture reads, 1 being the tuned default.
    texture: number
    backdrop: BackdropKey
    eyes: Eyes
    visorShape: VisorShape
    visor: VisorKey
    eye: EyeKey
    // A share of the framing's own visor size.
    visorSize: number
    // The light band across the top of the visor, 1 being its tuned strength and 0 none.
    shine: number
    grid: boolean
    hat: HatKey
    lamp: boolean
    tilt: boolean
    team: boolean
}

export const DEFAULT_BUDDY: BuddyConfig = {
    framing: 'rising',
    shape: 'sphere',
    color: 'white',
    finish: 'gloss',
    texture: 1,
    backdrop: 'indigo',
    eyes: 'pill',
    visorShape: 'pill',
    visor: 'dark',
    eye: 'lavender',
    visorSize: 1,
    shine: 1,
    grid: false,
    hat: 'yellow',
    lamp: false,
    tilt: false,
    team: false,
}

// Rerun's mark: the app icon of apps/mobile/assets/images/icon.png, drawn live.
export const BRAND_BUDDY: BuddyConfig = { ...DEFAULT_BUDDY, color: 'violet', finish: 'fur', backdrop: 'studio', eyes: 'happy', grid: true }

// The same mark a few pixels wide: fur and the visor's grid would only blur the face into a smudge.
export const COMPACT_BRAND_BUDDY: BuddyConfig = { ...BRAND_BUDDY, finish: 'flat', grid: false, visorSize: 1.15 }

export const TEXTURES: Texture[] = ['fur', 'shag', 'felt', 'boucle', 'sponge', 'moss', 'sugar', 'velvet']

export function isTexture(finish: Finish): finish is Texture {
    return (TEXTURES as Finish[]).includes(finish)
}
