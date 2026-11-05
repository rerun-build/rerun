import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password', () => {
    it('verifies the password it hashed, and only that one', async () => {
        const hash = await hashPassword('northwind-q3')
        expect(hash.startsWith('scrypt$')).toBe(true)
        await expect(verifyPassword('northwind-q3', hash)).resolves.toBe(true)
        await expect(verifyPassword('northwind-q4', hash)).resolves.toBe(false)
    })

    it('salts every hash', async () => {
        expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
    })

    it('refuses a missing or foreign hash', async () => {
        await expect(verifyPassword('x', null)).resolves.toBe(false)
        await expect(verifyPassword('x', 'bcrypt$whatever')).resolves.toBe(false)
    })

    it('refuses a password too short to protect anything', async () => {
        await expect(hashPassword('abc')).rejects.toThrow('at least 4')
    })
})
