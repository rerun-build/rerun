import { creatorNetCents, MARKETPLACE_FEE_FIXED_CENTS, rerunFeeCents, splitSale } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

describe('marketplace split', () => {
    it('takes the fee on what is left once the tax is carved out', () => {
        expect(splitSale(2000, 333)).toEqual({ taxCents: 333, feeCents: 113, netCents: 1554 })
    })

    it('leaves the whole price to split when the buyer reverse-charges the tax', () => {
        expect(splitSale(2000, 0)).toEqual({ taxCents: 0, feeCents: 130, netCents: 1870 })
    })

    it('never sends a creator a negative amount on a price the fixed fee alone would swallow', () => {
        expect(rerunFeeCents(20)).toBe(20)
        expect(creatorNetCents(20)).toBe(0)
        expect(splitSale(100, 90)).toEqual({ taxCents: 90, feeCents: 10, netCents: 0 })
    })

    it('charges no fee on a sale that settled at nothing', () => {
        expect(rerunFeeCents(0)).toBe(0)
        expect(splitSale(500, 500)).toEqual({ taxCents: 500, feeCents: 0, netCents: 0 })
    })

    it('keeps the fixed part of the fee whole rather than prorating it', () => {
        expect(rerunFeeCents(10_000) - rerunFeeCents(5_000)).toBe(250)
        expect(rerunFeeCents(5_000)).toBe(250 + MARKETPLACE_FEE_FIXED_CENTS)
    })
})
