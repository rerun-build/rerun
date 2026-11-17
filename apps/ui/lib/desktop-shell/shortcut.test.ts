import { formatAccelerator } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { acceleratorKeycaps, readRecordedKeys, shortcutProblem } from './shortcut'

const keys = (code: string, held: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({ code, ctrlKey: !!held.ctrl, altKey: !!held.alt, shiftKey: !!held.shift, metaKey: !!held.meta })

describe('readRecordedKeys', () => {
    it('reads the physical key, so ⌥K stays K on a Mac', () => {
        const read = readRecordedKeys(keys('KeyK', { alt: true, ctrl: true }), 'mac')
        expect(read.kind === 'shortcut' && formatAccelerator(read.shortcut)).toBe('Control+Alt+K')
    })

    it('names the Windows key Super and the Mac one Command', () => {
        const mac = readRecordedKeys(keys('Space', { meta: true, shift: true }), 'mac')
        const win = readRecordedKeys(keys('Space', { meta: true, shift: true }), 'win')
        expect(mac.kind === 'shortcut' && formatAccelerator(mac.shortcut)).toBe('Shift+Command+Space')
        expect(win.kind === 'shortcut' && formatAccelerator(win.shortcut)).toBe('Shift+Super+Space')
    })

    it('waits while only modifiers are down', () => {
        expect(readRecordedKeys(keys('ShiftLeft', { shift: true, meta: true }), 'mac')).toEqual({ kind: 'held', modifiers: ['Shift', 'Command'] })
    })

    it('treats Escape as cancel and ⌫ as turning the shortcut off, alone only', () => {
        expect(readRecordedKeys(keys('Escape'), 'mac')).toEqual({ kind: 'cancel' })
        expect(readRecordedKeys(keys('Backspace'), 'mac')).toEqual({ kind: 'clear' })
        expect(readRecordedKeys(keys('Backspace', { meta: true }), 'mac').kind).toBe('shortcut')
    })
})

describe('shortcutProblem', () => {
    it('asks for a modifier other than Shift, except on function keys', () => {
        expect(shortcutProblem({ modifiers: ['Shift'], key: 'K' }, 'mac')).toEqual({ problem: 'needsModifier' })
        expect(shortcutProblem({ modifiers: [], key: 'F6' }, 'mac')).toBeNull()
    })

    it('names what the system already uses the keys for', () => {
        expect(shortcutProblem({ modifiers: ['Command'], key: 'Space' }, 'mac')).toEqual({ problem: 'reserved', owner: 'spotlight' })
        expect(shortcutProblem({ modifiers: ['Alt'], key: 'Space' }, 'win')).toEqual({ problem: 'reserved', owner: 'windowMenu' })
        expect(shortcutProblem({ modifiers: ['Shift', 'Alt'], key: 'Tab' }, 'win')).toEqual({ problem: 'reserved', owner: 'appSwitcher' })
        expect(shortcutProblem({ modifiers: ['Command'], key: 'C' }, 'mac')).toEqual({ problem: 'reserved', owner: 'everyApp' })
        expect(shortcutProblem({ modifiers: ['Control'], key: 'V' }, 'linux')).toEqual({ problem: 'reserved', owner: 'everyApp' })
    })

    it('lets the default and an unused combination through', () => {
        expect(shortcutProblem({ modifiers: ['Shift', 'Command'], key: 'Space' }, 'mac')).toBeNull()
        expect(shortcutProblem({ modifiers: ['Control', 'Alt'], key: 'K' }, 'win')).toBeNull()
    })
})

describe('acceleratorKeycaps', () => {
    it('draws the keys the way each system prints them', () => {
        expect(acceleratorKeycaps('Shift+Command+Space', 'mac')).toEqual(['⇧', '⌘', 'Space'])
        expect(acceleratorKeycaps('Control+Shift+Space', 'win')).toEqual(['Ctrl', 'Shift', 'Space'])
        expect(acceleratorKeycaps('Control+Alt+Up', 'mac')).toEqual(['⌃', '⌥', '↑'])
        expect(acceleratorKeycaps('nonsense', 'mac')).toEqual([])
    })
})
