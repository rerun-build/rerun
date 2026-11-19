import { suggestionsOnOffer, type AgentSuggestion } from '@moldwright/ui/new-agent'
import { describe, expect, it } from 'vitest'

const POOL: AgentSuggestion[] = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, title: id, description: id, name: id, kickoff: id, apps: [] }))

const ids = (suggestions: AgentSuggestion[]) => suggestions.map(suggestion => suggestion.id)

describe('suggestionsOnOffer', () => {
    it('offers the whole pool when the dialog draws no window', () => {
        expect(suggestionsOnOffer(POOL, 0)).toBe(POOL)
    })

    it('offers the whole pool when it is no longer than the window', () => {
        expect(suggestionsOnOffer(POOL.slice(0, 3), 3, 3)).toHaveLength(3)
    })

    it('slides the window on at each reload', () => {
        expect(ids(suggestionsOnOffer(POOL, 0, 3))).toEqual(['a', 'b', 'c'])
        expect(ids(suggestionsOnOffer(POOL, 3, 3))).toEqual(['d', 'e', 'a'])
    })

    it('comes back round to the start rather than running out', () => {
        expect(ids(suggestionsOnOffer(POOL, 6, 3))).toEqual(['b', 'c', 'd'])
        expect(ids(suggestionsOnOffer(POOL, 15, 3))).toEqual(['a', 'b', 'c'])
    })
})
