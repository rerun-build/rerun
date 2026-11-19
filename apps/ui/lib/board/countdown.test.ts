import { countdownShort, isCountdownSoon } from '@moldwright/ui/iso-grid'
import { describe, expect, it } from 'vitest'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('countdownShort', () => {
    it('counts in the largest unit that fits', () => {
        expect(countdownShort(400)).toBe('1s')
        expect(countdownShort(45 * SECOND)).toBe('45s')
        expect(countdownShort(12 * MINUTE)).toBe('12m')
        expect(countdownShort(3 * HOUR + 10 * MINUTE)).toBe('3h')
        expect(countdownShort(4 * DAY + 5 * HOUR)).toBe('4d')
    })
})

describe('isCountdownSoon', () => {
    it('is the last quarter of an hour', () => {
        expect(isCountdownSoon(14 * MINUTE)).toBe(true)
        expect(isCountdownSoon(15 * MINUTE)).toBe(false)
    })
})
