import { formatAccelerator, parseAccelerator, shortcutNeedsModifier, SHORTCUT_MODIFIERS, type DesktopShellPlatform, type Shortcut, type ShortcutModifier } from '@rerun/contracts'

// Turns the keys pressed in the shortcut recorder into an accelerator for the desktop app, and an
// accelerator back into keycaps. Read from `event.code`, not `event.key`: on a Mac ⌥K types "˚",
// and the shortcut must still say ⌥K.

const NAMED_CODES: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Period: '.',
    Comma: ',',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
}

function keyFromCode(code: string): string | null {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit\d$/.test(code)) return code.slice(5)
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
    return NAMED_CODES[code] ?? null
}

type ModifierState = Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

function heldModifiers(event: ModifierState, platform: DesktopShellPlatform): ShortcutModifier[] {
    const held: ShortcutModifier[] = []
    if (event.ctrlKey) held.push('Control')
    if (event.altKey) held.push('Alt')
    if (event.shiftKey) held.push('Shift')
    if (event.metaKey) held.push(platform === 'mac' ? 'Command' : 'Super')
    return held
}

export type RecordedKeys = { kind: 'cancel' } | { kind: 'clear' } | { kind: 'held'; modifiers: ShortcutModifier[] } | { kind: 'shortcut'; shortcut: Shortcut }

// What one keydown means while the recorder listens. Escape and ⌫ alone are commands, not shortcuts.
export function readRecordedKeys(event: ModifierState & Pick<KeyboardEvent, 'code'>, platform: DesktopShellPlatform): RecordedKeys {
    const modifiers = heldModifiers(event, platform)
    if (modifiers.length === 0 && event.code === 'Escape') return { kind: 'cancel' }
    if (modifiers.length === 0 && (event.code === 'Backspace' || event.code === 'Delete')) return { kind: 'clear' }
    const key = keyFromCode(event.code)
    if (!key) return { kind: 'held', modifiers }
    return { kind: 'shortcut', shortcut: { modifiers, key } }
}

export type ShortcutOwner = 'spotlight' | 'finder' | 'inputSources' | 'appSwitcher' | 'screenshot' | 'windowMenu' | 'system' | 'everyApp'

const MAC_RESERVED: Record<string, ShortcutOwner> = {
    'Command+Space': 'spotlight',
    'Alt+Command+Space': 'finder',
    'Control+Space': 'inputSources',
    'Control+Alt+Space': 'inputSources',
    'Command+Tab': 'appSwitcher',
    'Shift+Command+Tab': 'appSwitcher',
    'Shift+Command+3': 'screenshot',
    'Shift+Command+4': 'screenshot',
    'Shift+Command+5': 'screenshot',
    'Control+Command+Q': 'system',
    'Shift+Command+Q': 'system',
}

const OTHER_RESERVED: Record<string, ShortcutOwner> = {
    'Alt+Tab': 'appSwitcher',
    'Alt+Shift+Tab': 'appSwitcher',
    'Alt+Space': 'windowMenu',
    'Alt+F4': 'system',
    'Super+Space': 'inputSources',
    'Super+L': 'system',
    'Control+Alt+Delete': 'system',
    'Shift+Super+S': 'screenshot',
}

// The editing keys every app answers: a global shortcut on them would take copy and paste away.
const EDITING_KEYS = new Set(['A', 'C', 'F', 'N', 'O', 'P', 'Q', 'S', 'T', 'V', 'W', 'X', 'Y', 'Z'])

export type ShortcutProblem = { problem: 'needsModifier' } | { problem: 'reserved'; owner: ShortcutOwner }

// Refused before the desktop app is even asked: Electron registers some of these without a word and
// the system keeps them anyway.
export function shortcutProblem(shortcut: Shortcut, platform: DesktopShellPlatform): ShortcutProblem | null {
    if (shortcutNeedsModifier(shortcut)) return { problem: 'needsModifier' }
    const accelerator = formatAccelerator(shortcut)
    const owner = (platform === 'mac' ? MAC_RESERVED : OTHER_RESERVED)[accelerator]
    if (owner) return { problem: 'reserved', owner }
    const primary = platform === 'mac' ? 'Command' : 'Control'
    if (shortcut.modifiers.length === 1 && shortcut.modifiers[0] === primary && EDITING_KEYS.has(shortcut.key)) return { problem: 'reserved', owner: 'everyApp' }
    return null
}

const MAC_SYMBOLS: Record<ShortcutModifier, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Super: '⌘' }
const OTHER_NAMES: Record<ShortcutModifier, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Command: 'Win', Super: 'Win' }
const KEY_GLYPHS: Record<string, string> = { Enter: '↵', Tab: '⇥', Backspace: '⌫', Delete: '⌦', Up: '↑', Down: '↓', Left: '←', Right: '→' }

export function modifierKeycaps(modifiers: readonly ShortcutModifier[], platform: DesktopShellPlatform): string[] {
    return SHORTCUT_MODIFIERS.filter(modifier => modifiers.includes(modifier)).map(modifier => (platform === 'mac' ? MAC_SYMBOLS[modifier] : OTHER_NAMES[modifier]))
}

export function shortcutKeycaps(shortcut: Shortcut, platform: DesktopShellPlatform): string[] {
    return [...modifierKeycaps(shortcut.modifiers, platform), KEY_GLYPHS[shortcut.key] ?? shortcut.key]
}

export function acceleratorKeycaps(accelerator: string, platform: DesktopShellPlatform): string[] {
    const shortcut = parseAccelerator(accelerator)
    return shortcut ? shortcutKeycaps(shortcut, platform) : []
}

// The modifier a person is told to add: the one their keyboard leads with.
export function primaryModifierKeycap(platform: DesktopShellPlatform): string {
    return platform === 'mac' ? MAC_SYMBOLS.Command : OTHER_NAMES.Control
}
