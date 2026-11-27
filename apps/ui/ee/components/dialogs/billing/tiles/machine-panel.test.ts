import { describe, expect, it } from 'vitest'

import { minPacksFor, tooFullFor } from './MachinePanel'

const large = (usedDiskGib: number | null) => ({ size: 'large' as const, diskGib: 150, usedDiskGib })

describe('tooFullFor', () => {
    it('refuses a smaller disk that what the machine holds would fill past three quarters', () => {
        expect(tooFullFor(large(55), 'medium', 0)).toBe(true)
        expect(tooFullFor(large(48), 'medium', 0)).toBe(true)
        expect(tooFullFor(large(45), 'medium', 0)).toBe(false)
        expect(tooFullFor(large(55), 'medium', 1)).toBe(false)
    })

    it('never refuses a disk at least as large as the machine has, nor a machine that never reported', () => {
        expect(tooFullFor(large(149), 'large', 0)).toBe(false)
        expect(tooFullFor(large(null), 'small', 0)).toBe(false)
        expect(tooFullFor(null, 'small', 0)).toBe(false)
    })
})

describe('minPacksFor', () => {
    it('is the fewest packs the data still fits in', () => {
        expect(minPacksFor(large(10), 'small', 10)).toBe(0)
        expect(minPacksFor(large(52), 'small', 10)).toBe(1)
        expect(minPacksFor(large(55), 'small', 10)).toBe(2)
        expect(minPacksFor(large(120), 'medium', 10)).toBe(2)
    })
})
