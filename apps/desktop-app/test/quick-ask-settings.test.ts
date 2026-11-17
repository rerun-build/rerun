import { describe, expect, it } from 'vitest'
import { storedQuickAskShortcut } from '../src/main/quick-ask-settings'

describe('storedQuickAskShortcut', () => {
    it('gives a fresh install the default shortcut', () => {
        expect(storedQuickAskShortcut({}, 'mac')).toBe('Shift+Command+Space')
        expect(storedQuickAskShortcut({}, 'linux')).toBe('Control+Shift+Space')
    })

    it('reads the switch of the shells that predate the recorder', () => {
        expect(storedQuickAskShortcut({ quickAsk: false }, 'mac')).toBeNull()
        expect(storedQuickAskShortcut({ quickAsk: true }, 'win')).toBe('Control+Shift+Space')
    })

    it('keeps the recorded shortcut, and off as off', () => {
        expect(storedQuickAskShortcut({ quickAsk: true, quickAskShortcut: 'Control+Alt+K' }, 'mac')).toBe('Control+Alt+K')
        expect(storedQuickAskShortcut({ quickAsk: true, quickAskShortcut: null }, 'mac')).toBeNull()
    })

    it('falls back to the default when the stored shortcut is no longer accepted', () => {
        expect(storedQuickAskShortcut({ quickAskShortcut: 'K' }, 'mac')).toBe('Shift+Command+Space')
    })
})
