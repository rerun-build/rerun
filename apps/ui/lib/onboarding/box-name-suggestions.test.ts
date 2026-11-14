import { describe, expect, it } from 'vitest'

import { boxNameSuggestions, DEFAULT_BOX_NAMES, INDUSTRY_BOX_NAMES } from './box-name-suggestions'

describe('boxNameSuggestions', () => {
    it('falls back to the defaults when the industry says nothing', () => {
        expect(boxNameSuggestions(null, [])).toEqual(DEFAULT_BOX_NAMES.slice(0, 4))
        expect(boxNameSuggestions(undefined, [])).toEqual(DEFAULT_BOX_NAMES.slice(0, 4))
    })

    it('falls back to the defaults on a label that is no longer a category', () => {
        expect(boxNameSuggestions('healthcare', [])).toEqual(DEFAULT_BOX_NAMES.slice(0, 4))
    })

    it('falls back to the defaults for a category with no list of its own', () => {
        expect(INDUSTRY_BOX_NAMES.other).toEqual([])
        expect(boxNameSuggestions('other', [])).toEqual(DEFAULT_BOX_NAMES.slice(0, 4))
    })

    it('takes the industry list, most universal first', () => {
        expect(boxNameSuggestions('saas', [])).toEqual(INDUSTRY_BOX_NAMES.saas.slice(0, 4))
    })

    it('drops the names the workspace already uses, whatever their case and spacing', () => {
        expect(boxNameSuggestions('saas', ['  pRoDuCt ', 'MARKETING'])).toEqual(['Engineering', 'Support', 'Sales', 'Finance'])
    })

    it('ignores an unnamed Box', () => {
        expect(boxNameSuggestions('saas', [''])).toEqual(INDUSTRY_BOX_NAMES.saas.slice(0, 4))
    })

    it('never offers more than four pills', () => {
        for (const category of Object.keys(INDUSTRY_BOX_NAMES)) {
            expect(boxNameSuggestions(category, []).length, category).toBe(4)
        }
    })

    it('keeps enough spare names behind the four', () => {
        for (const [category, names] of Object.entries(INDUSTRY_BOX_NAMES)) {
            if (category === 'other') continue
            expect(names.length, category).toBeGreaterThanOrEqual(6)
        }
        expect(DEFAULT_BOX_NAMES.length).toBeGreaterThanOrEqual(6)
    })
})
