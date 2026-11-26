import { z } from 'zod'

// What a coworker's buddy can wear. The order of each list is part of the drawing: a coworker nobody
// dressed gets the entry its id hashes to, so reordering one would change every such buddy.
export const COWORKER_EYES = ['pill', 'round', 'happy', 'googly', 'visor', 'sleepy', 'wink', 'pixel', 'star', 'heart', 'dot', 'brows', 'cyclops', 'shades', 'glasses', 'sparkle', 'line'] as const
export const COWORKER_MOUTHS = ['none', 'smile', 'open', 'cat', 'flat'] as const
// The colours a coworker nobody dressed is hashed to. Amber, red and cyan are left out: on the board
// they mean working, broken and waiting for you.
export const COWORKER_COLORS = ['#0f52ff', '#4fb800', '#f0127f', '#7a2cf5', '#e935c1', '#3b32e8', '#00b862', '#a81fe0'] as const
// Offered in the picker next to them, kept out of the hash so no undressed buddy changes colour:
// orange, sky, teal, brown and graphite.
const COWORKER_ADDED_COLORS = ['#ff6a13', '#2b9bf4', '#0e9f8e', '#8d5a3b', '#5d6778'] as const
export const COWORKER_PALETTE = [...COWORKER_COLORS, ...COWORKER_ADDED_COLORS] as const
// From the softest to the hardest. `classic` is the block drawn before materials existed, and what a
// look without one wears: no id ever hashes to another.
export const COWORKER_MATERIALS = ['classic', 'fluffy', 'plush', 'felt', 'knit', 'clay', 'rubber', 'glass', 'chrome'] as const

// Any colour, the palette's or one picked freely, as `#rrggbb`, kept in lower case.
const coworkerColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).toLowerCase()

export const coworkerLookSchema = z.object({
    eyes: z.enum(COWORKER_EYES),
    mouth: z.enum(COWORKER_MOUTHS),
    color: coworkerColorSchema,
    material: z.enum(COWORKER_MATERIALS).optional(),
})
export type CoworkerLook = z.infer<typeof coworkerLookSchema>

// A look read back from storage, null when it is missing or no longer one the buddy can wear.
export function parseCoworkerLook(value: unknown): CoworkerLook | null {
    const parsed = coworkerLookSchema.safeParse(value)
    return parsed.success ? parsed.data : null
}

const linearChannel = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function oklab(hex: string): [number, number, number] {
    const [r, g, b] = [1, 3, 5].map(index => linearChannel(parseInt(hex.slice(index, index + 2), 16)))
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

// How far apart two `#rrggbb` colours look: OKLab follows the eye, so the same distance reads the
// same in every hue.
export function coworkerColorDistance(a: string, b: string): number {
    const [l1, a1, b1] = oklab(a)
    const [l2, a2, b2] = oklab(b)
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

// The hashed colour a free one looks most like: what a build that only knows those eight is sent.
export function nearestHashedCoworkerColor(hex: string): (typeof COWORKER_COLORS)[number] {
    return COWORKER_COLORS.reduce((best, color) => (coworkerColorDistance(hex, color) < coworkerColorDistance(hex, best) ? color : best))
}
