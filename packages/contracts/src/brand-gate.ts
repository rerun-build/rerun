export const BRAND_GATE_COOKIE = 'rerun-kit'
export const BRAND_GATE_PARAM = 'key'
export const BRAND_GATE_MAX_AGE = 365 * 24 * 60 * 60

export const LANDING_GATED_PATHS = ['/preview'] as const
export const APP_GATED_PATHS = ['/render/lab'] as const

export function isGatedPath(pathname: string, paths: readonly string[]): boolean {
    return paths.some(path => pathname === path || pathname.startsWith(`${path}/`))
}

export type BrandGateVerdict = 'open' | 'grant' | 'deny'

export function brandGateVerdict(input: {
    secret: string | undefined
    param: string | null | undefined
    cookie: string | undefined
    production: boolean
}): BrandGateVerdict {
    if (!input.production) return 'open'
    if (!input.secret) return 'deny'
    if (input.param && input.param === input.secret) return 'grant'
    return input.cookie === input.secret ? 'open' : 'deny'
}
