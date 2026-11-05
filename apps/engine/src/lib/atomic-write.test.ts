import { mkdtempSync } from 'node:fs'
import { chmod, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic-write.js'

describe('writeFileAtomic', () => {
    it('replaces the content and leaves no temp file', async () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'rerun-atomic-'))
        const path = resolve(dir, 'file.md')
        await writeFile(path, 'old')
        await writeFileAtomic(path, 'new')
        expect(await readFile(path, 'utf8')).toBe('new')
        expect(await readdir(dir)).toEqual(['file.md'])
    })

    // A reader racing the writers sees one whole version or another, never an empty file.
    it('never exposes an empty file to a concurrent reader', async () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'rerun-atomic-'))
        const path = resolve(dir, 'file.md')
        await writeFile(path, 'version-start')
        const seen: string[] = []
        await Promise.all([
            ...Array.from({ length: 30 }, (_, i) => writeFileAtomic(path, `version-${i}`)),
            ...Array.from({ length: 30 }, async () => seen.push(await readFile(path, 'utf8'))),
        ])
        expect(seen.every(content => content.startsWith('version-'))).toBe(true)
        expect(await readdir(dir)).toEqual(['file.md'])
    })

    it('applies the mode asked for, on a new file and over a wider existing one', async () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'rerun-atomic-'))
        const mode = async (path: string) => (await stat(path)).mode & 0o777
        const fresh = resolve(dir, 'fresh.json')
        await writeFileAtomic(fresh, '{}', { mode: 0o600 })
        expect(await mode(fresh)).toBe(0o600)

        const wide = resolve(dir, 'wide.json')
        await writeFile(wide, '{}')
        await chmod(wide, 0o644)
        await writeFileAtomic(wide, '{"a":1}', { mode: 0o600 })
        expect(await mode(wide)).toBe(0o600)
        expect(await readFile(wide, 'utf8')).toBe('{"a":1}')
        expect(await readdir(dir)).toEqual(['fresh.json', 'wide.json'])
    })

    it('cleans its temp file up when the target cannot be written', async () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'rerun-atomic-'))
        await expect(writeFileAtomic(resolve(dir, 'missing', 'file.md'), 'x')).rejects.toThrow()
        expect(await readdir(dir)).toEqual([])
    })
})
