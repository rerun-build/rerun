export type ForemanMaterialKey = 'platinum' | 'gold' | 'chrome' | 'obsidian' | 'holo' | 'glass'

type Stop = [offset: number, color: string]

export type ForemanMaterial = {
    label: string
    side: Stop[]
    shade: number
    top: [lit: string, far: string]
    topGloss: number
    bevel: string
    outline: string[]
    neon?: boolean
    sheen: string
    plate: [upper: string, lower: string]
    eyeTint: string
    eyeLight: string
    bareInk: 'light' | 'dark'
    aura?: string
    ball: ForemanBallPaint
}

export type ForemanBallPaint = {
    stops: Stop[]
    bounce: string
    horizon?: string
}

export const FOREMAN_MATERIALS: Record<ForemanMaterialKey, ForemanMaterial> = {
    platinum: {
        label: 'Platinum',
        side: [[0, '#dfe3ea'], [0.1, '#ffffff'], [0.26, '#b4bac6'], [0.4, '#d6dae3'], [0.49, '#eef0f5'], [0.52, '#7a8090'], [0.68, '#565b69'], [0.86, '#8d93a2'], [1, '#42464f']],
        shade: 0.3,
        top: ['#ffffff', '#cdd2dc'],
        topGloss: 0.55,
        bevel: '#ffffff',
        outline: ['#ffffff'],
        sheen: '#ffffff',
        plate: ['#2b2e3a', '#0b0c11'],
        eyeTint: '#c8d2ff',
        eyeLight: '#dfe6ff',
        bareInk: 'dark',
        ball: { stops: [[0, '#ffffff'], [0.25, '#e3e6ed'], [0.55, '#aab0bd'], [0.82, '#6b7080'], [1, '#454955']], bounce: '#dfe3ea' },
    },
    gold: {
        label: 'Gold',
        side: [[0, '#f3cf63'], [0.1, '#fff6cf'], [0.26, '#d19c2c'], [0.4, '#f0c655'], [0.49, '#ffe9a3'], [0.52, '#9a6a17'], [0.68, '#74500f'], [0.86, '#b98a2a'], [1, '#573a09']],
        shade: 0.3,
        top: ['#fff7d6', '#e6b84a'],
        topGloss: 0.5,
        bevel: '#fff6cf',
        outline: ['#fff3c4'],
        sheen: '#fffbe6',
        plate: ['#33240a', '#0f0a02'],
        eyeTint: '#ffd76a',
        eyeLight: '#ffe9a3',
        bareInk: 'dark',
        ball: { stops: [[0, '#fffbe6'], [0.22, '#ffe08a'], [0.52, '#dba632'], [0.8, '#96660f'], [1, '#5b3c08']], bounce: '#ffd76a' },
    },
    chrome: {
        label: 'Chrome',
        side: [[0, '#aab2c2'], [0.08, '#ffffff'], [0.2, '#8b94a8'], [0.3, '#1d212b'], [0.4, '#dfe4ee'], [0.49, '#ffffff'], [0.52, '#0d0f15'], [0.66, '#4d5464'], [0.8, '#c9cfdb'], [0.9, '#2a2e39'], [1, '#12141a']],
        shade: 0.2,
        top: ['#ffffff', '#8c95a9'],
        topGloss: 0.75,
        bevel: '#ffffff',
        outline: ['#ffffff'],
        sheen: '#ffffff',
        plate: ['#1c1f29', '#050609'],
        eyeTint: '#9fd4ff',
        eyeLight: '#cfeaff',
        bareInk: 'dark',
        ball: { stops: [[0, '#ffffff'], [0.2, '#dfe4ee'], [0.5, '#8b94a8'], [0.78, '#2a2e39'], [1, '#0d0f15']], bounce: '#cfd6e4', horizon: '#0d0f15' },
    },
    obsidian: {
        label: 'Obsidian neon',
        side: [[0, '#2d1769'], [0.14, '#3a1f85'], [0.34, '#1b0c48'], [0.49, '#241056'], [0.52, '#0d0428'], [0.8, '#0a0322'], [1, '#050114']],
        shade: 0.25,
        top: ['#3f2391', '#170a3d'],
        topGloss: 0.22,
        bevel: '#c05cff',
        outline: ['#ffdcf8', '#ff7ae2', '#c05cff', '#7b45ff', '#4d34f7', '#b968ff', '#ffdcf8'],
        neon: true,
        sheen: '#f0e2ff',
        plate: ['#150835', '#04010f'],
        eyeTint: '#d9b8ff',
        eyeLight: '#ffdcf8',
        bareInk: 'light',
        aura: '#4d34f7',
        ball: { stops: [[0, '#5a36c4'], [0.3, '#3a1f85'], [0.6, '#1b0c48'], [0.85, '#0d0428'], [1, '#050114']], bounce: '#7b45ff' },
    },
    holo: {
        label: 'Holo pearl',
        side: [[0, '#ffd9f3'], [0.12, '#ffffff'], [0.24, '#cdbcff'], [0.36, '#b3e4ff'], [0.49, '#c8ffe8'], [0.52, '#8a79d6'], [0.66, '#6a8fdc'], [0.82, '#74c2c9'], [1, '#5a4c9c']],
        shade: 0.22,
        top: ['#ffffff', '#e0d0ff'],
        topGloss: 0.6,
        bevel: '#ffffff',
        outline: ['#ffd9f3', '#cdbcff', '#b3e4ff', '#c8ffe8', '#ffd9f3'],
        sheen: '#ffffff',
        plate: ['#231a4a', '#090516'],
        eyeTint: '#b3e4ff',
        eyeLight: '#ffd9f3',
        bareInk: 'dark',
        ball: { stops: [[0, '#ffffff'], [0.22, '#ffd9f3'], [0.45, '#cdbcff'], [0.65, '#b3e4ff'], [0.82, '#8a79d6'], [1, '#5a4c9c']], bounce: '#c8ffe8' },
    },
    glass: {
        label: 'Indigo glass',
        side: [[0, '#6f5cff'], [0.08, '#d5ceff'], [0.18, '#5a44f8'], [0.4, '#4d34f7'], [0.49, '#9d8eff'], [0.52, '#2a1ab0'], [0.74, '#1c1180'], [0.92, '#4734d6'], [1, '#120a5c']],
        shade: 0.28,
        top: ['#a99bff', '#4d34f7'],
        topGloss: 0.6,
        bevel: '#e3deff',
        outline: ['#ffffff'],
        sheen: '#ffffff',
        plate: ['#130b52', '#05021f'],
        eyeTint: '#b9adff',
        eyeLight: '#e3deff',
        bareInk: 'light',
        aura: '#4d34f7',
        ball: { stops: [[0, '#e3deff'], [0.2, '#a99bff'], [0.5, '#4d34f7'], [0.8, '#2a1ab0'], [1, '#120a5c']], bounce: '#9d8eff' },
    },
}

export const FOREMAN_MATERIAL_KEYS = Object.keys(FOREMAN_MATERIALS) as ForemanMaterialKey[]

export const FOREMAN_HEIGHTS = [
    { depth: 30, label: 'Agent' },
    { depth: 48, label: 'Tall' },
    { depth: 66, label: 'Taller' },
    { depth: 84, label: 'Tower' },
]

export const FOREMAN_BALL_SIZES = [
    { scale: 1, label: 'Agent' },
    { scale: 1.15, label: 'Big' },
    { scale: 1.3, label: 'Bigger' },
    { scale: 1.5, label: 'Huge' },
]
