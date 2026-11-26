import { createHmac } from 'crypto'

// RFC 6238 with the parameters every authenticator app and Supabase use: SHA-1, 30 seconds, 6 digits.
const STEP_SECONDS = 30
const DIGITS = 6
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Decode(secret: string): Buffer {
    const clean = secret.replace(/[\s=-]/g, '').toUpperCase()
    let bits = 0
    let value = 0
    const bytes: number[] = []
    for (const char of clean) {
        const index = BASE32.indexOf(char)
        if (index === -1) throw new Error('Invalid base32 secret')
        value = (value << 5) | index
        bits += 5
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff)
            bits -= 8
        }
    }
    return Buffer.from(bytes)
}

export function hotp(key: Buffer, counter: number, digits = DIGITS, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
    const message = Buffer.alloc(8)
    message.writeBigUInt64BE(BigInt(counter))
    const digest = createHmac(algorithm, key).update(message).digest()
    const offset = digest[digest.length - 1] & 0x0f
    const binary = digest.readUInt32BE(offset) & 0x7fffffff
    return String(binary % 10 ** digits).padStart(digits, '0')
}

export function totp(secret: string, at: number = Date.now(), stepOffset = 0): string {
    return hotp(base32Decode(secret), Math.floor(at / 1000 / STEP_SECONDS) + stepOffset)
}
