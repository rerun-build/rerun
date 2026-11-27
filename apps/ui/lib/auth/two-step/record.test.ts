import { describe, expect, it } from 'vitest'
import { readTwoStepRecord } from './record'

describe('readTwoStepRecord', () => {
    it('reads nothing stored as an account without two-step', () => {
        expect(readTwoStepRecord(null)).toEqual({})
        expect(readTwoStepRecord(undefined)).toEqual({})
    })

    it('reads what the hub wrote', () => {
        const record = { recovery: { factorId: 'recovery', sealedSecret: 'sealed' }, salt: 'salt', codes: [{ hash: 'abc', usedAt: null }] }
        expect(readTwoStepRecord(record)).toEqual(record)
    })

    it('throws on a record it cannot read, rather than pass for an account without methods', () => {
        expect(() => readTwoStepRecord({ passkeys: [{ id: 'pk-1' }] })).toThrow()
        expect(() => readTwoStepRecord('broken')).toThrow()
    })
})
