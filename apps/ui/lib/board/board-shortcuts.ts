import { isTypingTarget } from '@/lib/typing-target'

type BoxRect = { col_start: number; col_end: number; row_start: number; row_end: number }

export type BoardShortcut = { kind: 'zoomIn' } | { kind: 'zoomOut' } | { kind: 'fitAll' } | { kind: 'fitBox'; index: number }

export const MAX_BOX_SHORTCUTS = 9

// Reading order of the board, top to bottom then left to right: the north corner of each diamond
// sits higher the smaller col + row is, and further left the smaller col - row is.
export function orderBoxesForShortcuts<T extends BoxRect>(boxes: readonly T[]): T[] {
    const corner = (box: T) => ({ col: Math.min(box.col_start, box.col_end), row: Math.min(box.row_start, box.row_end) })
    return [...boxes]
        .sort((a, b) => {
            const ca = corner(a)
            const cb = corner(b)
            return ca.col + ca.row - (cb.col + cb.row) || ca.col - ca.row - (cb.col - cb.row)
        })
        .slice(0, MAX_BOX_SHORTCUTS)
}

// The digit typed comes first, then the key of the top row it sits on: on AZERTY that row types
// `&`, `é`, `"`… without Shift. Zoom is read before both, because the 6 key of a Windows AZERTY
// types `-`, the only minus of that keyboard outside the keypad: it zooms out, Shift 6 frames Box 6.
export function boardShortcutFor(event: Pick<KeyboardEvent, 'key' | 'code'>): BoardShortcut | null {
    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return { kind: 'zoomIn' }
    if (event.key === '-' || event.code === 'NumpadSubtract') return { kind: 'zoomOut' }
    const digit = /^\d$/.test(event.key) ? Number(event.key) : /^Digit\d$/.test(event.code) ? Number(event.code.slice(-1)) : null
    if (digit === null) return null
    return digit === 0 ? { kind: 'fitAll' } : { kind: 'fitBox', index: digit - 1 }
}

// Never with ⌘, Ctrl or Alt (⌘+ and ⌘− stay the browser's page zoom), never while typing or inside
// a dialog, a menu or a list that searches its options as you type.
export function boardKeyAllowed(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>): boolean {
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return false
    return !(event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"]'))
}

export function shortcutRepeats(shortcut: BoardShortcut): boolean {
    return shortcut.kind === 'zoomIn' || shortcut.kind === 'zoomOut'
}
