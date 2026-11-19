import { describe, expect, it } from 'vitest'

import { closestSuggestion, NO_APP_SELECTION, selectedApps, toggleApp } from '@moldwright/ui/new-agent/apps'

describe('selectedApps', () => {
    it('merges the suggestion, the reading and the hand picked apps, once each', () => {
        expect(selectedApps(['gmail', 'slack'], ['slack', 'notion'], { added: ['stripe'], removed: [] })).toEqual(['gmail', 'slack', 'notion', 'stripe'])
    })

    it('keeps an app taken off by hand off, even when it is read again', () => {
        expect(selectedApps([], ['gmail', 'slack'], { added: [], removed: ['gmail'] })).toEqual(['slack'])
    })

    it('stops at six apps', () => {
        expect(selectedApps([], ['a', 'b', 'c', 'd', 'e'], { added: ['f', 'g'], removed: [] })).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    })
})

describe('toggleApp', () => {
    it('adds an app that was not selected', () => {
        expect(toggleApp(NO_APP_SELECTION, 'gmail', false)).toEqual({ added: ['gmail'], removed: [] })
    })

    it('takes a read app off, and puts it back', () => {
        const off = toggleApp(NO_APP_SELECTION, 'gmail', true)
        expect(off).toEqual({ added: [], removed: ['gmail'] })
        expect(selectedApps([], ['gmail'], toggleApp(off, 'gmail', false))).toEqual(['gmail'])
    })
})

describe('closestSuggestion', () => {
    const suggestions = [
        { id: 'a', apps: ['gmail'] },
        { id: 'b', apps: ['gmail', 'slack'] },
    ]

    it('picks the suggestion sharing the most apps', () => {
        expect(closestSuggestion(['gmail', 'slack'], suggestions)?.id).toBe('b')
    })

    it('picks none when no app is shared', () => {
        expect(closestSuggestion(['notion'], suggestions)).toBeNull()
    })
})
