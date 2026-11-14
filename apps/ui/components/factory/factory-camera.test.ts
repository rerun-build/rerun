import { describe, expect, it } from 'vitest'
import { floorFrame } from './factory-camera'

const base = { stage: { width: 1400, height: 900 }, rightInset: 380, topSpace: 0, bottomSpace: 110, overhead: 120, side: 40 }

describe('floorFrame', () => {
    it('with no top bar gives the numbers the camera used before', () => {
        expect(floorFrame(base)).toEqual({ width: 940, height: 670, shiftX: -190, shiftY: 5 })
    })

    it('a top bar takes its height from the fitted floor and moves the centre down by half of it', () => {
        expect(floorFrame({ ...base, topSpace: 70 })).toEqual({ width: 940, height: 600, shiftX: -190, shiftY: 40 })
    })

    it('never gives less than 1', () => {
        const f = floorFrame({ ...base, stage: { width: 100, height: 100 }, topSpace: 500 })
        expect(f.width).toBe(1)
        expect(f.height).toBe(1)
    })
})
