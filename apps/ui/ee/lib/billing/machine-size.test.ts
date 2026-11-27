import { describe, expect, it } from 'vitest'
import { INCLUDED_MACHINE_SIZE, MACHINE_SIZES, MACHINE_SPECS, MAX_STORAGE_PACKS, PAID_MACHINE_SIZES, compareMachineSizes, isMachineSize, largerMachineSize, machineDiskGib, parseMachineSize } from '@rerun/contracts'

describe('the machine sizes', () => {
    it('are sold from the smallest to the largest, the plan coming with the smallest', () => {
        expect(MACHINE_SIZES).toEqual(['small', 'medium', 'large'])
        expect(INCLUDED_MACHINE_SIZE).toBe('small')
        expect(PAID_MACHINE_SIZES).toEqual(['medium', 'large'])
    })

    it('grow on every resource from one size to the next', () => {
        for (let i = 1; i < MACHINE_SIZES.length; i++) {
            const smaller = MACHINE_SPECS[MACHINE_SIZES[i - 1]!]
            const larger = MACHINE_SPECS[MACHINE_SIZES[i]!]
            expect(larger.vcpus).toBeGreaterThan(smaller.vcpus)
            expect(larger.memoryGib).toBeGreaterThan(smaller.memoryGib)
            expect(larger.diskGib).toBeGreaterThan(smaller.diskGib)
        }
    })

    it('reads an unknown column value as the included size', () => {
        expect(parseMachineSize('large')).toBe('large')
        expect(parseMachineSize('xl')).toBe('small')
        expect(parseMachineSize(null)).toBe('small')
        expect(isMachineSize('medium')).toBe(true)
        expect(isMachineSize('Medium')).toBe(false)
    })

    it('orders two sizes', () => {
        expect(compareMachineSizes('small', 'large')).toBeLessThan(0)
        expect(compareMachineSizes('large', 'medium')).toBeGreaterThan(0)
        expect(compareMachineSizes('medium', 'medium')).toBe(0)
        expect(largerMachineSize('medium', 'small')).toBe('medium')
        expect(largerMachineSize('medium', 'large')).toBe('large')
    })

    it('adds 50 GB of disk per storage pack, up to ten', () => {
        expect(machineDiskGib('small', 0)).toBe(20)
        expect(machineDiskGib('medium', 2)).toBe(160)
        expect(machineDiskGib('large', MAX_STORAGE_PACKS)).toBe(650)
    })
})
