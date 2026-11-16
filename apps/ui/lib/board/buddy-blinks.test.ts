import { BLINK_MS, BLINK_PERIOD_MS, msUntilBlink } from '@rerun/ui/iso-grid'
import { describe, expect, it } from 'vitest'

// The blink a face used to run as an endless 4.6 s CSS animation, shut for its last 8 %: the
// scheduler has to open the same 0.368 s window at the same instant of the same cycle.
describe('msUntilBlink', () => {
    it('keeps the period and the length of the old CSS blink', () => {
        expect(BLINK_PERIOD_MS).toBe(4600)
        expect(BLINK_MS).toBeCloseTo(368)
    })

    it('blinks at the last 8 % of the cycle, like the animation did', () => {
        expect(msUntilBlink(0, 0)).toBeCloseTo(4232)
        expect(msUntilBlink(4232, 0)).toBe(0)
        expect(msUntilBlink(4232 + BLINK_PERIOD_MS * 3, 0)).toBe(0)
    })

    it('still blinks when the timer fires a little late, never twice in one cycle', () => {
        expect(msUntilBlink(4300, 0)).toBe(0)
        expect(msUntilBlink(4400, 0)).toBeCloseTo(4600 - 168)
    })

    it('shifts each agent by its negative --buddy-blink-delay, as animation-delay did', () => {
        expect(msUntilBlink(2232, -2000)).toBe(0)
        expect(msUntilBlink(0, -2000)).toBeCloseTo(2232)
    })
})
