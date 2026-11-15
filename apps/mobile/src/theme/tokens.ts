export const palette = {
    light: {
        background: '#f8f8f8',
        foreground: '#0a0a0a',
        card: '#ffffff',
        primary: '#171717',
        primaryForeground: '#fafafa',
        secondary: '#efefef',
        muted: '#efefef',
        mutedForeground: '#737373',
        border: '#e4e4e4',
        input: '#e0e0e0',
        destructive: '#e7000b',
        waiting: '#0e7490',
        buddyBody: '#4a4e5c',
        buddyAsleep: '#94a3b8',
    },
    dark: {
        background: '#0a0a0a',
        foreground: '#fafafa',
        card: '#171717',
        primary: '#e5e5e5',
        primaryForeground: '#171717',
        secondary: '#262626',
        muted: '#232323',
        mutedForeground: '#a1a1a1',
        border: 'rgba(255,255,255,0.10)',
        input: 'rgba(255,255,255,0.15)',
        destructive: '#ff6467',
        waiting: '#22d3ee',
        buddyBody: '#666c7e',
        buddyAsleep: '#646876',
    },
} as const

export type ColorScheme = keyof typeof palette
export type Palette = { [K in keyof (typeof palette)['light']]: string }

export const brand = {
    base: '#4d34f7',
    soft: '#b7a8ff',
} as const

export const radius = {
    sm: 8,
    md: 12,
    lg: 18,
    xl: 24,
    pill: 999,
} as const

export const controlSize = {
    sm: { height: 36, radius: 10 },
    md: { height: 44, radius: 12 },
    lg: { height: 52, radius: 14 },
} as const

export type ControlSize = keyof typeof controlSize

export const spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
} as const

export const fonts = {
    regular: 'Inter-Regular',
    medium: 'Inter-Medium',
    semibold: 'Inter-SemiBold',
    italic: 'Inter-Italic',
    mono: 'GeistMono-Regular',
} as const

function channels(hex: string): [number, number, number] {
    const raw = hex.slice(1)
    const full = raw.length === 3 ? [...raw].map(c => c + c).join('') : raw.slice(0, 6)
    const value = parseInt(full, 16)
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export function withAlpha(color: string, alpha: number): string {
    if (!color.startsWith('#')) return color
    const [r, g, b] = channels(color)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function mix(a: string, b: string, share: number): string {
    const from = channels(a)
    const to = channels(b)
    const hex = from.map((value, i) => Math.round(value + (to[i] - value) * share).toString(16).padStart(2, '0'))
    return `#${hex.join('')}`
}
