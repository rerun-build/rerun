import type { DesktopShellPlatform } from './desktop-shell.js'

// The global shortcuts of the desktop app, in Electron's accelerator syntax (`Shift+Command+Space`).
// The web app records them, the shell registers them: both read and write them through these
// functions, and the shell checks again whatever a page sends it.

// `text` opens Quick ask on its field, `voice` opens it listening.
export const QUICK_ASK_SHORTCUT_KINDS = ['text', 'voice'] as const
export type QuickAskShortcutKind = (typeof QUICK_ASK_SHORTCUT_KINDS)[number]

// In the order a Mac menu prints them: ⌃ ⌥ ⇧ ⌘. `Super` is the Windows key, `Command` its Mac twin.
export const SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Command', 'Super'] as const
export type ShortcutModifier = (typeof SHORTCUT_MODIFIERS)[number]

export type Shortcut = { modifiers: ShortcutModifier[]; key: string }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const DIGITS = '0123456789'.split('')
const FUNCTION_KEYS = Array.from({ length: 24 }, (_, index) => `F${index + 1}`)
const NAMED_KEYS = ['Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Up', 'Down', 'Left', 'Right', '.', ',', '/', '\\', ';', "'", '[', ']', '`', '-', '=']

const SHORTCUT_KEYS: ReadonlySet<string> = new Set([...LETTERS, ...DIGITS, ...FUNCTION_KEYS, ...NAMED_KEYS])

const MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
    control: 'Control',
    ctrl: 'Control',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    command: 'Command',
    cmd: 'Command',
    super: 'Super',
    meta: 'Super',
}

function isFunctionKey(key: string): boolean {
    return /^F([1-9]|1\d|2[0-4])$/.test(key)
}

// A shortcut that would fire while the person types: a bare key, or Shift and a key.
export function shortcutNeedsModifier(shortcut: Shortcut): boolean {
    return !isFunctionKey(shortcut.key) && !shortcut.modifiers.some((modifier) => modifier !== 'Shift')
}

export function formatAccelerator(shortcut: Shortcut): string {
    const modifiers = SHORTCUT_MODIFIERS.filter((modifier) => shortcut.modifiers.includes(modifier))
    return [...modifiers, shortcut.key].join('+')
}

// `Command+Shift+Space` and `shift+cmd+space` read the same. `CommandOrControl` is left out on
// purpose: a stored shortcut names the keys of the machine it was recorded on.
export function parseAccelerator(accelerator: string): Shortcut | null {
    if (typeof accelerator !== 'string' || accelerator.length > 64) return null
    const parts = accelerator.split('+')
    // `Command+=` splits into a trailing empty part only when the key is `+` itself, which is not offered.
    if (parts.some((part) => part === '')) return null
    const modifiers: ShortcutModifier[] = []
    for (const part of parts.slice(0, -1)) {
        const modifier = MODIFIER_ALIASES[part.toLowerCase()]
        if (!modifier || modifiers.includes(modifier)) return null
        modifiers.push(modifier)
    }
    const rawKey = parts[parts.length - 1]
    const key = rawKey.length === 1 ? rawKey.toUpperCase() : [...SHORTCUT_KEYS].find((candidate) => candidate.toLowerCase() === rawKey.toLowerCase())
    if (!key || !SHORTCUT_KEYS.has(key)) return null
    return { modifiers, key }
}

// What the shell accepts for Quick ask: a known key and a modifier, written in its canonical form.
export function quickAskAccelerator(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const shortcut = parseAccelerator(value)
    if (!shortcut || shortcutNeedsModifier(shortcut)) return null
    return formatAccelerator(shortcut)
}

export function defaultQuickAskAccelerator(platform: DesktopShellPlatform): string {
    return platform === 'mac' ? 'Shift+Command+Space' : 'Control+Shift+Space'
}

// The same keys on every system: ⌥⇧Space on a Mac, Alt+Shift+Space elsewhere.
export const DEFAULT_QUICK_ASK_VOICE_ACCELERATOR = 'Alt+Shift+Space'
