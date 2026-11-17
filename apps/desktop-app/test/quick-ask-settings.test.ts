import { describe, expect, it } from 'vitest'
import { storedQuickAskShortcut, storedQuickAskVoiceShortcut } from '../src/main/quick-ask-settings'

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

describe('storedQuickAskVoiceShortcut', () => {
    it('gives every install ⌥⇧Space until the person changes it', () => {
        expect(storedQuickAskVoiceShortcut({})).toBe('Alt+Shift+Space')
        expect(storedQuickAskVoiceShortcut({ quickAskVoiceShortcut: 'Control+Alt+V' })).toBe('Control+Alt+V')
        expect(storedQuickAskVoiceShortcut({ quickAskVoiceShortcut: null })).toBeNull()
        expect(storedQuickAskVoiceShortcut({ quickAskVoiceShortcut: 'V' })).toBe('Alt+Shift+Space')
    })
})
