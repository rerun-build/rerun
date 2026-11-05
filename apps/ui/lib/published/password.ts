import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const KEY_LENGTH = 32
const SCRYPT_COST = 16_384
const SCRYPT_BLOCK = 8
const SCRYPT_PARALLEL = 1
const PREFIX = 'scrypt'

export const MIN_PASSWORD_LENGTH = 4
export const MAX_PASSWORD_LENGTH = 128

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => scrypt(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key))))
}

export function validatePassword(password: string): string {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`)
    if (password.length > MAX_PASSWORD_LENGTH) throw new Error(`Keep the password under ${MAX_PASSWORD_LENGTH} characters.`)
    return password
}

// `scrypt$N$r$p$salt$key`, so the cost can be raised later without breaking the hashes stored.
export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16)
    const key = await derive(validatePassword(password), salt, { N: SCRYPT_COST, r: SCRYPT_BLOCK, p: SCRYPT_PARALLEL })
    return [PREFIX, SCRYPT_COST, SCRYPT_BLOCK, SCRYPT_PARALLEL, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
    const [prefix, n, r, p, salt, key] = (stored ?? '').split('$')
    if (prefix !== PREFIX || !salt || !key || password.length > MAX_PASSWORD_LENGTH) return false
    const expected = Buffer.from(key, 'base64url')
    const given = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) })
    return given.length === expected.length && timingSafeEqual(given, expected)
}
