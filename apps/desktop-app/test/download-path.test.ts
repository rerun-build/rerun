import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { safeFilename, uniqueDownloadPath } from '../src/main/download-path'

describe('safeFilename', () => {
    it('keeps a name inside the Downloads folder', () => {
        expect(safeFilename('../../.ssh/authorized_keys')).toBe('authorized_keys')
        expect(safeFilename('..\\..\\Windows\\evil.exe')).toBe('evil.exe')
        expect(safeFilename('.hidden')).toBe('hidden')
        expect(safeFilename('a<b>c:d|e?.csv')).toBe('a_b_c_d_e_.csv')
        expect(safeFilename('')).toBe('download')
    })
})

describe('uniqueDownloadPath', () => {
    it('never overwrites a file already there', () => {
        const taken = new Set([join('/d', 'report.csv'), join('/d', 'report (1).csv')])
        expect(uniqueDownloadPath('/d', 'report.csv', (path) => taken.has(path))).toBe(join('/d', 'report (2).csv'))
        expect(uniqueDownloadPath('/d', 'new.csv', (path) => taken.has(path))).toBe(join('/d', 'new.csv'))
    })
})
