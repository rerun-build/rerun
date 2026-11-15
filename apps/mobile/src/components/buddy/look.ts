import { mix } from '@/theme/tokens'

export type BuddyEyes = 'pill' | 'round' | 'happy' | 'googly' | 'visor' | 'sleepy' | 'wink' | 'pixel' | 'star' | 'heart' | 'dot' | 'brows' | 'cyclops' | 'shades' | 'glasses' | 'sparkle' | 'line'
export type BuddyMouth = 'none' | 'smile' | 'open' | 'cat' | 'flat'
export type BuddyMood = 'idle' | 'working' | 'error' | 'waiting' | 'asleep'
export type BuddyLook = { eyes?: BuddyEyes; mouth?: BuddyMouth; color?: string }

export const BUDDY_EYES: BuddyEyes[] = ['pill', 'round', 'happy', 'googly', 'visor', 'sleepy', 'wink', 'pixel', 'star', 'heart', 'dot', 'brows', 'cyclops', 'shades', 'glasses', 'sparkle', 'line']
export const BUDDY_MOODS: BuddyMood[] = ['idle', 'working', 'waiting', 'error', 'asleep']

const MOUTH_ODDS: BuddyMouth[] = ['none', 'none', 'none', 'smile', 'open', 'cat', 'flat']

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

export function shade(color: string, amount: number) {
    return mix(color, amount >= 0 ? '#ffffff' : '#000000', Math.min(1, Math.abs(amount)))
}
