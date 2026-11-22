import { mix } from '@/theme/tokens'

// Ported from packages/ui/src/iso-grid (buddy-look.ts, iso.ts, types.ts): the same id has to give
// the same buddy on the phone as on the board.

export type BuddyEyes = 'pill' | 'round' | 'happy' | 'googly' | 'visor' | 'sleepy' | 'wink' | 'pixel' | 'star' | 'heart' | 'dot' | 'brows' | 'cyclops' | 'shades' | 'glasses' | 'sparkle' | 'line'
export type BuddyMouth = 'none' | 'smile' | 'open' | 'cat' | 'flat'
export type BuddyMood = 'idle' | 'working' | 'error' | 'waiting' | 'asleep'
export type BuddyMaterial = 'classic' | 'fluffy' | 'plush' | 'felt' | 'knit' | 'clay' | 'rubber' | 'glass' | 'chrome'
export type BuddyLook = { eyes?: BuddyEyes; mouth?: BuddyMouth; color?: string; material?: BuddyMaterial }

export const BUDDY_EYES: BuddyEyes[] = ['pill', 'round', 'happy', 'googly', 'visor', 'sleepy', 'wink', 'pixel', 'star', 'heart', 'dot', 'brows', 'cyclops', 'shades', 'glasses', 'sparkle', 'line']
export const BUDDY_MOODS: BuddyMood[] = ['idle', 'working', 'waiting', 'error', 'asleep']

// Most buddies have no mouth: the eyes carry the face.
const MOUTH_ODDS: BuddyMouth[] = ['none', 'none', 'none', 'smile', 'open', 'cat', 'flat']

// The colour of a resting agent's top. Amber, red and cyan are left out: they mean working, broken
// and waiting for you.
const IDENTITY = ['#0f52ff', '#4fb800', '#f0127f', '#7a2cf5', '#e935c1', '#3b32e8', '#00b862', '#a81fe0']

export const BUDDY_HEIGHT_RATIO = 15 / 80

export function hashUnit(input: string, salt: number) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return ((h >>> 0) % 10000) / 10000
}

export function buddyEyes(id: string, look: BuddyLook): BuddyEyes {
    return look.eyes ?? BUDDY_EYES[Math.floor(hashUnit(id, 41) * BUDDY_EYES.length)]
}

export function buddyMouth(id: string, look: BuddyLook): BuddyMouth {
    return look.mouth ?? MOUTH_ODDS[Math.floor(hashUnit(id, 53) * MOUTH_ODDS.length)]
}

export function buddyColor(id: string, look: BuddyLook = {}) {
    return look.color ?? IDENTITY[Math.floor(hashUnit(id, 23) * IDENTITY.length)]
}

// Lightens (amount > 0, towards white) or darkens (amount < 0, towards black) a hex colour.
export function shade(color: string, amount: number) {
    return mix(color, amount >= 0 ? '#ffffff' : '#000000', Math.min(1, Math.abs(amount)))
}

export function buddyMaterial(look: BuddyLook): BuddyMaterial {
    return look.material ?? 'classic'
}

type Stop = [offset: number, amount: number]

// The walls' gradient, from the lit front-left wall to the right one in shade, as shades of the
// body's colour. Chrome draws a studio instead.
export const MATERIAL_SIDE: Record<BuddyMaterial, Stop[]> = {
    classic: [[0, -0.1], [0.44, -0.26], [0.56, -0.46], [1, -0.6]],
    fluffy: [[0, 0.04], [0.44, -0.08], [0.56, -0.2], [1, -0.3]],
    plush: [[0, 0], [0.44, -0.12], [0.56, -0.26], [1, -0.38]],
    felt: [[0, -0.04], [0.44, -0.16], [0.56, -0.3], [1, -0.42]],
    knit: [[0, -0.02], [0.44, -0.14], [0.56, -0.3], [1, -0.42]],
    clay: [[0, 0.02], [0.4, -0.1], [0.6, -0.28], [1, -0.4]],
    rubber: [[0, -0.12], [0.44, -0.24], [0.56, -0.42], [1, -0.55]],
    glass: [[0, 0.5], [0.4, 0.25], [0.6, 0.05], [1, -0.15]],
    chrome: [[0, 0], [1, 0]],
}

// Soft and squeezable materials round their corners more.
export const MATERIAL_RADIUS: Partial<Record<BuddyMaterial, number>> = { fluffy: 14, plush: 12, clay: 15, rubber: 13, felt: 11 }

// Chrome is a mirror: almost no colour of its own, it shows a studio around it, a bright ceiling, a
// dark horizon, the floor and two softboxes. Each stop is how dark the reflection is there.
export const CHROME_LIT: Stop[] = [[0, 0], [0.26, 0.08], [0.38, 0.45], [0.42, 0.97], [0.62, 0.9], [1, 0.68]]
export const CHROME_SHADE: Stop[] = [[0, 0.28], [0.32, 0.5], [0.4, 0.98], [0.7, 0.94], [1, 0.84]]
export const CHROME_TOP: Stop[] = [[0, 0], [0.28, 0.06], [0.43, 0.3], [0.47, 0.88], [0.72, 0.78], [1, 0.4]]

// The colour that tints the mirror, and how much of it (0…1): the coworker's colour only tints it, a
// state tints it harder so the board still reads amber, red or cyan.
export type ChromeTint = { color: string; share: number }

export function chromeTone({ color, share }: ChromeTint, darkness: number) {
    return mix(mix('#ffffff', '#08090b', darkness), color, share)
}
