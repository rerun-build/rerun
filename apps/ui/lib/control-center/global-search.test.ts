import { describe, expect, it } from 'vitest'

import { highlightParts, splitPath, stepFilter, stillSearching, type SearchSource } from './global-search'

describe('stepFilter', () => {
    it('walks the chips forward and back, round and round', () => {
        expect(stepFilter('all', 1)).toBe('coworker')
        expect(stepFilter('conversation', 1)).toBe('all')
        expect(stepFilter('all', -1)).toBe('conversation')
        expect(stepFilter('table', -1)).toBe('brain')
    })
})

describe('highlightParts', () => {
    it('marks every mention, whatever its case', () => {
        expect(highlightParts('Boost the boost', 'BOOST')).toEqual([
            { text: 'Boost', match: true },
            { text: ' the ', match: false },
            { text: 'boost', match: true },
        ])
        expect(highlightParts('a boost here', 'boost')).toEqual([
            { text: 'a ', match: false },
            { text: 'boost', match: true },
            { text: ' here', match: false },
        ])
    })

    it('leaves the text whole under two characters or without a mention', () => {
        expect(highlightParts('boost', 'b')).toEqual([{ text: 'boost', match: false }])
        expect(highlightParts('capo', 'boost')).toEqual([{ text: 'capo', match: false }])
    })
})

describe('splitPath', () => {
    it('separates the folder from the name', () => {
        expect(splitPath('marketing/q4-plan.md')).toEqual({ name: 'q4-plan.md', folder: 'marketing/' })
        expect(splitPath('plan.md')).toEqual({ name: 'plan.md', folder: '' })
    })
})

describe('stillSearching', () => {
    const none = new Set<SearchSource>()
    const loading = (machine: boolean, conversations: boolean) => ({ machine, conversations })

    it('waits for the conversations on their chip, and on All while nothing is found', () => {
        expect(stillSearching('conversation', none, loading(false, true))).toBe(true)
        expect(stillSearching('conversation', none, loading(true, false))).toBe(false)
        expect(stillSearching('all', none, loading(false, true))).toBe(true)
        expect(stillSearching('all', new Set(['file']), loading(false, true))).toBe(false)
    })

    it('waits for the machine on All until it answers, and on a source with nothing to show', () => {
        expect(stillSearching('all', new Set(['coworker']), loading(true, false))).toBe(true)
        expect(stillSearching('all', new Set(['table']), loading(true, false))).toBe(false)
        expect(stillSearching('coworker', none, loading(true, false))).toBe(true)
        expect(stillSearching('coworker', new Set(['coworker']), loading(true, false))).toBe(false)
        expect(stillSearching('brain', none, loading(false, true))).toBe(false)
    })
})
