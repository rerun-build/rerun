export const EXPERIMENT_COOKIE = 'rerun-ab'

export const EXPERIMENT_COOKIE_MAX_AGE = 90 * 24 * 60 * 60

export const EXPERIMENT_VALUES = {
    price1: ['49', '29'],
} as const

export type ExperimentKey = keyof typeof EXPERIMENT_VALUES

export type ExperimentValue<K extends ExperimentKey> = (typeof EXPERIMENT_VALUES)[K][number]

export type ExperimentVariants = { [K in ExperimentKey]?: ExperimentValue<K> }

export type PriceVariant = ExperimentValue<'price1'>

export const EXPERIMENT_KEYS = Object.keys(EXPERIMENT_VALUES) as readonly ExperimentKey[]

export const EXPERIMENT_WEIGHTS: { [K in ExperimentKey]?: Record<ExperimentValue<K>, number> } = {
    price1: { '49': 0, '29': 1 },
}

function pick<T>(values: readonly T[]): T {
    return values[Math.floor(Math.random() * values.length)]
}

function pickWeighted<T extends string>(weights: Record<T, number>): T {
    const entries = (Object.entries(weights) as [T, number][]).filter(([, weight]) => weight > 0)
    let remaining = Math.random() * entries.reduce((total, [, weight]) => total + weight, 0)
    for (const [value, weight] of entries) {
        if (remaining < weight) return value
        remaining -= weight
    }
    return entries[entries.length - 1][0]
}

export function drawVariant<K extends ExperimentKey>(key: K): ExperimentValue<K> {
    const weights = EXPERIMENT_WEIGHTS[key]
    return weights ? pickWeighted(weights) : pick(EXPERIMENT_VALUES[key])
}

export function isRetiredVariant<K extends ExperimentKey>(key: K, value: ExperimentValue<K>): boolean {
    return EXPERIMENT_WEIGHTS[key]?.[value] === 0
}

const CRAWLER_USER_AGENT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|quora link preview|whatsapp|lighthouse|pagespeed|headlesschrome/i

export function isCrawler(userAgent: string | null | undefined): boolean {
    return !userAgent || CRAWLER_USER_AGENT.test(userAgent)
}

export function parseExperimentCookie(raw: string | undefined | null): ExperimentVariants {
    const variants: Record<string, string> = {}
    if (!raw) return variants
    for (const pair of raw.split('|')) {
        const [key, value] = pair.split(':')
        const allowed = EXPERIMENT_VALUES[key as ExperimentKey] as readonly string[] | undefined
        if (allowed?.includes(value)) variants[key] = value
    }
    return variants
}

export function serializeExperimentVariants(variants: ExperimentVariants): string {
    return EXPERIMENT_KEYS.filter(key => variants[key])
        .map(key => `${key}:${variants[key]}`)
        .join('|')
}

export function experimentProperties(variants: ExperimentVariants): Record<string, string> {
    const properties: Record<string, string> = {}
    for (const key of EXPERIMENT_KEYS) {
        const value = variants[key]
        if (value) properties[`ab_${key}`] = value
    }
    return properties
}

export const STALE_EXPERIMENT_PROPERTIES = [
    'ab_hero',
    'ab_hero2',
    'ab_hero3',
    'ab_hero4',
    'ab_hero5',
    'ab_hero6',
    'ab_hero7',
    'ab_hero_composer',
    'ab_hero_visual',
    'ab_hero_band',
]

export function readExperimentCookie(): ExperimentVariants {
    if (typeof document === 'undefined') return {}
    const match = document.cookie.match(new RegExp(`(?:^|; )${EXPERIMENT_COOKIE}=([^;]*)`))
    return parseExperimentCookie(match ? decodeURIComponent(match[1]) : undefined)
}

export function writeExperimentVariants(variants: ExperimentVariants) {
    const parts = [
        `${EXPERIMENT_COOKIE}=${encodeURIComponent(serializeExperimentVariants(variants))}`,
        'path=/',
        `max-age=${EXPERIMENT_COOKIE_MAX_AGE}`,
        'SameSite=Lax',
    ]
    if (location.hostname.endsWith('rerun.build')) parts.push('domain=.rerun.build')
    if (location.protocol === 'https:') parts.push('Secure')
    document.cookie = parts.join('; ')
}

export function clearExperimentCookie() {
    const parts = [`${EXPERIMENT_COOKIE}=`, 'path=/', 'max-age=0']
    if (location.hostname.endsWith('rerun.build')) parts.push('domain=.rerun.build')
    document.cookie = parts.join('; ')
}
