import { describe, expect, it } from 'vitest'
import { nextPinnedIds, settledPinnedIds } from '@moldwright/contracts'

const proposal = (id: string, status: 'proposed' | 'accepted' | 'applied' | 'failed' | 'dismissed') => ({ id, status })

describe('nextPinnedIds', () => {
    it('pins a proposal waiting on the user and one waiting on a retry', () => {
        expect(nextPinnedIds(new Set(), [proposal('a', 'proposed'), proposal('b', 'failed')])).toEqual(new Set(['a', 'b']))
    })

    it('leaves the one being written to the transcript', () => {
        expect(nextPinnedIds(new Set(), [proposal('a', 'accepted')])).toEqual(new Set())
    })

    it('hands an accepted proposal back to the transcript without waiting for the timer', () => {
        expect(nextPinnedIds(new Set(['a']), [proposal('a', 'accepted')])).toEqual(new Set())
    })

    it('leaves a proposal settled before the conversation opened in the transcript', () => {
        expect(nextPinnedIds(new Set(), [proposal('a', 'applied'), proposal('b', 'dismissed')])).toEqual(new Set())
    })

    it('keeps holding one it already had once it settles, so the timer releases it', () => {
        expect(nextPinnedIds(new Set(['a']), [proposal('a', 'dismissed')])).toEqual(new Set(['a']))
    })

    it('drops an id whose row is gone', () => {
        expect(nextPinnedIds(new Set(['a']), [])).toEqual(new Set())
    })
})

describe('settledPinnedIds', () => {
    it('names only the held ones that reached a decision', () => {
        expect(settledPinnedIds(new Set(['a', 'b', 'c']), [proposal('a', 'proposed'), proposal('b', 'applied'), proposal('c', 'dismissed')])).toEqual(['b', 'c'])
    })

    it('ignores a settled row the dock never held', () => {
        expect(settledPinnedIds(new Set(), [proposal('a', 'applied')])).toEqual([])
    })
})
