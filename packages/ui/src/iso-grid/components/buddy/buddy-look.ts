import { hashUnit } from '../../iso'
import type { AgentStatus } from '../../presets'
import type { BuddyEyes, BuddyLook, BuddyMood, BuddyMouth, TileStyle } from '../../types'

export type { BuddyMood }

export const BUDDY_EYES: BuddyEyes[] = ['pill', 'round', 'happy', 'googly', 'visor', 'sleepy', 'wink', 'pixel', 'star', 'heart', 'dot', 'brows', 'cyclops', 'shades', 'glasses', 'sparkle', 'line']

export const BUDDY_MOUTHS: BuddyMouth[] = ['none', 'smile', 'open', 'cat', 'flat']
const MOUTH_ODDS: BuddyMouth[] = ['none', 'none', 'none', 'smile', 'open', 'cat', 'flat']

export const BUDDY_STATE_COLOR: Record<BuddyMood, string> = {
    idle: 'var(--iso-buddy-body)',
    working: '#f59e0b',
    error: '#ef4444',
    waiting: '#06b6d4',
    asleep: 'var(--iso-buddy-asleep)',
}

const IDENTITY = ['#0f52ff', '#4fb800', '#f0127f', '#7a2cf5', '#e935c1', '#3b32e8', '#00b862', '#a81fe0']

export function buddyLook(style: TileStyle): BuddyLook {
    return style.buddy === true || style.buddy == null ? {} : style.buddy
}

export function buddyEyes(id: string, look: BuddyLook): BuddyEyes {
    return look.eyes ?? BUDDY_EYES[Math.floor(hashUnit(id, 41) * BUDDY_EYES.length)]
}

export function buddyMouth(id: string, look: BuddyLook): BuddyMouth {
    return look.mouth ?? MOUTH_ODDS[Math.floor(hashUnit(id, 53) * MOUTH_ODDS.length)]
}

export function buddyColor(id: string, look: BuddyLook) {
    return look.color ?? IDENTITY[Math.floor(hashUnit(id, 23) * IDENTITY.length)]
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

export function buddyMoodOfStatus(status: AgentStatus, disabled = false): BuddyMood {
    return disabled ? 'asleep' : STATUS_MOOD[status]
}

export function shade(color: string, amount: number) {
    const share = Math.round(Math.min(1, Math.abs(amount)) * 100)
    return `color-mix(in srgb, ${color}, ${amount >= 0 ? 'white' : 'black'} ${share}%)`
}
