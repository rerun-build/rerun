import { beforeEach, describe, expect, it } from 'vitest'

import { forgetStamps, shouldStamp } from './stamp-memory'

const MINUTE = 60_000

describe('shouldStamp', () => {
    beforeEach(() => forgetStamps())

    it('lets the first write of a key through, then none until the interval has passed', () => {
        expect(shouldStamp('key:a', 5 * MINUTE, 0)).toBe(true)
        expect(shouldStamp('key:a', 5 * MINUTE, 4 * MINUTE)).toBe(false)
        expect(shouldStamp('key:a', 5 * MINUTE, 5 * MINUTE)).toBe(true)
    })

    it('keeps each key apart', () => {
        expect(shouldStamp('key:a', 5 * MINUTE, 0)).toBe(true)
        expect(shouldStamp('key:b', 5 * MINUTE, 0)).toBe(true)
    })

    it('counts the interval from the last write that went out, not from the refused ones', () => {
        shouldStamp('key:a', 5 * MINUTE, 0)
        shouldStamp('key:a', 5 * MINUTE, 3 * MINUTE)
        expect(shouldStamp('key:a', 5 * MINUTE, 5 * MINUTE)).toBe(true)
    })
})
