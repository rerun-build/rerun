import { describe, expect, it } from 'vitest'
import { base32Decode, hotp, totp } from './totp'

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890", 8 digits.
const RFC_SEED = Buffer.from('12345678901234567890')
const RFC_VECTORS: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
]

describe('totp', () => {
    it('matches the RFC 6238 vectors', () => {
        for (const [seconds, code] of RFC_VECTORS) expect(hotp(RFC_SEED, Math.floor(seconds / 30), 8)).toBe(code)
    })

    it('reads a base32 secret the way authenticator apps show it', () => {
        expect(base32Decode('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ')).toEqual(RFC_SEED)
        expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082')
    })

    it('moves to the next code at the next step', () => {
        const secret = 'JBSWY3DPEHPK3PXP'
        expect(totp(secret, 0, 1)).toBe(totp(secret, 30_000))
    })

    it('refuses a secret that is not base32', () => {
        expect(() => base32Decode('not base32!')).toThrow()
    })
})
