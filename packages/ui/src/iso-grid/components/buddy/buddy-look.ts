import { COWORKER_COLORS, COWORKER_EYES, COWORKER_MOUTHS, type CoworkerLook } from '@rerun/contracts'
import { hashUnit } from '../../iso'
import type { AgentStatus } from '../../presets'
import type { BuddyEyes, BuddyLook, BuddyMood, BuddyMouth, TileStyle } from '../../types'

export type { BuddyMood }

export const BUDDY_EYES: readonly BuddyEyes[] = COWORKER_EYES

// Most buddies have no mouth: the eyes carry the face, and a board full of smiles gets loud.
export const BUDDY_MOUTHS: readonly BuddyMouth[] = COWORKER_MOUTHS
const MOUTH_ODDS: BuddyMouth[] = ['none', 'none', 'none', 'smile', 'open', 'cat', 'flat']

// The body keeps the tile preset's state colours, so the board reads the way it does today: amber
// at work, red when broken, cyan when it waits for you. The two resting bodies follow the theme.
export const BUDDY_STATE_COLOR: Record<BuddyMood, string> = {
    idle: 'var(--iso-buddy-body)',
    working: '#f59e0b',
    error: '#ef4444',
    waiting: '#06b6d4',
    asleep: 'var(--iso-buddy-asleep)',
}

export function buddyLook(style: TileStyle): BuddyLook {
    return style.buddy === true || style.buddy == null ? {} : style.buddy
}

export function buddyEyes(id: string, look: BuddyLook): BuddyEyes {
    return look.eyes ?? hashedBuddyLook(id).eyes
}

export function buddyMouth(id: string, look: BuddyLook): BuddyMouth {
    return look.mouth ?? hashedBuddyLook(id).mouth
}

export function buddyColor(id: string, look: BuddyLook) {
    return look.color ?? hashedBuddyLook(id).color
}

// The look a coworker wears until someone chooses one for it.
export function hashedBuddyLook(id: string): CoworkerLook {
    return {
        eyes: COWORKER_EYES[Math.floor(hashUnit(id, 41) * COWORKER_EYES.length)],
        mouth: MOUTH_ODDS[Math.floor(hashUnit(id, 53) * MOUTH_ODDS.length)],
        color: COWORKER_COLORS[Math.floor(hashUnit(id, 23) * COWORKER_COLORS.length)],
    }
}

export function buddyMood(style: TileStyle): BuddyMood {
    const pinned = buddyLook(style).mood
    if (pinned) return pinned
    if (style.errorPulse) return 'error'
    if (style.pingRings || style.badge === 'hand') return 'waiting'
    if (style.shimmer) return 'working'
    if (style.badge === 'lock') return 'asleep'
    return 'idle'
}

const STATUS_MOOD: Record<AgentStatus, BuddyMood> = { idle: 'idle', working: 'working', error: 'error', waiting_human: 'waiting', offline: 'asleep' }

// The mood the board gives an agent, for a buddy drawn away from it.
export function buddyMoodOfStatus(status: AgentStatus, disabled = false): BuddyMood {
    return disabled ? 'asleep' : STATUS_MOOD[status]
}

// Lightens (amount > 0, towards white) or darkens (amount < 0, towards black) any CSS colour, a
// theme variable included, so a shaded colour can be shaded again.
export function shade(color: string, amount: number) {
    const share = Math.round(Math.min(1, Math.abs(amount)) * 100)
    return `color-mix(in srgb, ${color}, ${amount >= 0 ? 'white' : 'black'} ${share}%)`
}
