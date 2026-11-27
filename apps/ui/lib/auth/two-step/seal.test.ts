import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSecret, opensSecret, sealSecret } from './seal'

const SECRET = 'JBSWY3DPEHPK3PXP'

describe('the seal of the recovery secret', () => {
    beforeEach(() => {
        vi.stubEnv('SUPABASE_SECRET_KEY', 'service-key')
        vi.stubEnv('TWO_STEP_SEAL_KEY', '')
    })
    afterEach(() => vi.unstubAllEnvs())

    it('seals with the service key when the install names no key of its own', () => {
        const sealed = sealSecret(SECRET)
        expect(sealed).not.toContain(SECRET)
        expect(openSecret(sealed)).toBe(SECRET)
    })

    it('outlives a rotated service key once it has a key of its own', () => {
        vi.stubEnv('TWO_STEP_SEAL_KEY', 'seal-key')
        const sealed = sealSecret(SECRET)
        vi.stubEnv('SUPABASE_SECRET_KEY', 'rotated-service-key')
        expect(openSecret(sealed)).toBe(SECRET)
    })

    it('rotates by putting the new key in front of the old one', () => {
        vi.stubEnv('TWO_STEP_SEAL_KEY', 'old-key')
        const before = sealSecret(SECRET)
        vi.stubEnv('TWO_STEP_SEAL_KEY', 'new-key, old-key')
        expect(openSecret(before)).toBe(SECRET)

        const after = sealSecret(SECRET)
        vi.stubEnv('TWO_STEP_SEAL_KEY', 'new-key')
        expect(openSecret(after)).toBe(SECRET)
        expect(opensSecret(before)).toBe(false)
    })

    it('still opens what the service key sealed before the install named a key of its own', () => {
        const sealed = sealSecret(SECRET)
        vi.stubEnv('TWO_STEP_SEAL_KEY', 'seal-key')
        expect(openSecret(sealed)).toBe(SECRET)
    })

    it('refuses a secret no key of this server opens, or one that was tampered with', () => {
        const sealed = sealSecret(SECRET)
        vi.stubEnv('SUPABASE_SECRET_KEY', 'rotated-service-key')
        expect(opensSecret(sealed)).toBe(false)
        expect(() => openSecret(sealed)).toThrow()
        expect(opensSecret('not-a-sealed-secret')).toBe(false)
    })

    it('asks for a key before sealing anything', () => {
        vi.stubEnv('SUPABASE_SECRET_KEY', '')
        expect(() => sealSecret(SECRET)).toThrow('TWO_STEP_SEAL_KEY')
    })
})
