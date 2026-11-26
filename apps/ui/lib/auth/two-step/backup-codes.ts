import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { BACKUP_CODE_COUNT, type TwoStepRecord } from './record'

// No 0/O nor 1/I/L: a code is read off paper.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const HALF = 4

function randomHalf(): string {
    return Array.from({ length: HALF }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

export function normalizeBackupCode(code: string): string {
    return code.toUpperCase().replace(/[^0-9A-Z]/g, '')
}

export function hashBackupCode(code: string, salt: string): string {
    return createHash('sha256').update(`${salt}:${normalizeBackupCode(code)}`).digest('hex')
}

// The codes, shown once, and what is kept of them.
export function generateBackupCodes(): { codes: string[]; salt: string; stored: NonNullable<TwoStepRecord['codes']> } {
    const salt = randomBytes(16).toString('base64url')
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => `${randomHalf()}-${randomHalf()}`)
    return { codes, salt, stored: codes.map(code => ({ hash: hashBackupCode(code, salt), usedAt: null })) }
}

export function backupCodesLeft(record: TwoStepRecord): number {
    return (record.codes ?? []).filter(code => code.usedAt === null).length
}

// The record with the code marked spent, or null when no unspent code matches. Every stored hash is
// compared, so the time taken says nothing about which one matched.
export function spendBackupCode(record: TwoStepRecord, code: string, now: Date = new Date()): TwoStepRecord | null {
    if (!record.salt || !record.codes?.length || normalizeBackupCode(code).length !== HALF * 2) return null
    const given = Buffer.from(hashBackupCode(code, record.salt), 'hex')
    let matched = -1
    record.codes.forEach((stored, index) => {
        const same = timingSafeEqual(Buffer.from(stored.hash, 'hex'), given)
        if (same && stored.usedAt === null && matched === -1) matched = index
    })
    if (matched === -1) return null
    return { ...record, codes: record.codes.map((stored, index) => (index === matched ? { ...stored, usedAt: now.toISOString() } : stored)) }
}
