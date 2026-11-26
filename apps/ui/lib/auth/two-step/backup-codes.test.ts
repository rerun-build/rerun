import { describe, expect, it } from 'vitest'
import { backupCodesLeft, generateBackupCodes, spendBackupCode } from './backup-codes'
import { BACKUP_CODE_COUNT } from './record'

describe('backup codes', () => {
    it('makes ten XXXX-XXXX codes and keeps only their hashes', () => {
        const { codes, salt, stored } = generateBackupCodes()
        expect(codes).toHaveLength(BACKUP_CODE_COUNT)
        for (const code of codes) expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/)
        expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT)
        expect(JSON.stringify(stored)).not.toContain(codes[0])
        expect(backupCodesLeft({ salt, codes: stored })).toBe(BACKUP_CODE_COUNT)
    })

    it('opens once, then never again', () => {
        const { codes, salt, stored } = generateBackupCodes()
        const after = spendBackupCode({ salt, codes: stored }, codes[3])
        expect(after).not.toBeNull()
        expect(backupCodesLeft(after!)).toBe(BACKUP_CODE_COUNT - 1)
        expect(spendBackupCode(after!, codes[3])).toBeNull()
    })

    it('reads a code typed in lowercase, without the dash or with spaces', () => {
        const { codes, salt, stored } = generateBackupCodes()
        const typed = ` ${codes[0].replace('-', ' ').toLowerCase()} `
        expect(spendBackupCode({ salt, codes: stored }, typed)).not.toBeNull()
    })

    it('refuses a wrong code and a record without codes', () => {
        const { salt, stored } = generateBackupCodes()
        expect(spendBackupCode({ salt, codes: stored }, 'ABCD-EFGH')).toBeNull()
        expect(spendBackupCode({ salt, codes: stored }, '')).toBeNull()
        expect(spendBackupCode({}, 'ABCD-EFGH')).toBeNull()
    })
})
