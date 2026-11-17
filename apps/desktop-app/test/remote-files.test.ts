import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ComputerFiles } from '../src/worker/files'

const posix = process.platform !== 'win32'
const home = mkdtempSync(join(tmpdir(), 'rerun-files-home-'))
const workDir = join(home, 'Rerun')
const outside = join(home, 'Movies')
mkdirSync(workDir, { recursive: true })
mkdirSync(outside, { recursive: true })
mkdirSync(join(home, '.ssh'), { recursive: true })
writeFileSync(join(home, '.ssh', 'id_ed25519'), 'PRIVATE KEY')
writeFileSync(join(outside, 'day2.mov'), Buffer.alloc(3000, 0))
writeFileSync(join(workDir, 'notes été.txt'), 'Vidéos été 2026\n')

const files = new ComputerFiles(posix ? 'linux' : 'win', () => workDir, home)
const inWorkDir = { roots: [workDir], sensitiveOk: false }
const anywhere = { roots: null, sensitiveOk: false }
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

describe('the files of a linked computer', () => {
    it('lists, stats and reads inside the working folder, paths relative to it', async () => {
        const listing = await files.list('.', inWorkDir)
        expect(listing.entries.map(entry => entry.name)).toContain('notes été.txt')
        expect((await files.stat('notes été.txt', inWorkDir)).entry).toMatchObject({ type: 'file', size: Buffer.byteLength('Vidéos été 2026\n') })
        expect(await files.read('notes été.txt', 1000, inWorkDir)).toMatchObject({ content: 'Vidéos été 2026\n', encoding: 'utf8', truncated: false })
    })

    it('reads a binary file as such, and stops at the size asked', async () => {
        const read = await files.read(join(outside, 'day2.mov'), 100, anywhere)
        expect(read).toMatchObject({ encoding: 'base64', size: 3000, truncated: true })
        expect(Buffer.from(read.content, 'base64')).toHaveLength(100)
    })

    it('refuses a path outside the roots the engine gave, .. included', async () => {
        await expect(files.read(join(outside, 'day2.mov'), 100, inWorkDir)).rejects.toMatchObject({ code: 'outside_workdir' })
        await expect(files.read('../Movies/day2.mov', 100, inWorkDir)).rejects.toMatchObject({ code: 'outside_workdir' })
        await expect(files.write('../escape.txt', 'x', 'utf8', inWorkDir)).rejects.toMatchObject({ code: 'outside_workdir' })
        expect(existsSync(join(home, 'escape.txt'))).toBe(false)
    })

    it.runIf(posix)('follows a link to where it really leads before deciding', async () => {
        symlinkSync(outside, join(workDir, 'movies-link'))
        await expect(files.read('movies-link/day2.mov', 10, inWorkDir)).rejects.toMatchObject({ code: 'outside_workdir' })
        symlinkSync(join(home, '.ssh'), join(workDir, 'keys'))
        await expect(files.read('keys/id_ed25519', 10, anywhere)).rejects.toMatchObject({ code: 'sensitive_path' })
        await expect(files.write('keys/new', 'x', 'utf8', inWorkDir)).rejects.toMatchObject({ code: 'sensitive_path' })
    })

    it('never touches where secrets live without the yes, whatever the roots, and does with it', async () => {
        await expect(files.read('~/.ssh/id_ed25519', 100, anywhere)).rejects.toMatchObject({ code: 'sensitive_path' })
        await expect(files.list('~/.ssh', anywhere)).rejects.toMatchObject({ code: 'sensitive_path' })
        expect((await files.read('~/.ssh/id_ed25519', 100, { roots: null, sensitiveOk: true })).content).toBe('PRIVATE KEY')
    })

    it('writes through a temporary file, creating the folders it needs', async () => {
        const written = await files.write('Exports/2026/list.txt', 'a\nb\n', 'utf8', inWorkDir)
        expect(written.size).toBe(4)
        expect(readFileSync(join(workDir, 'Exports', '2026', 'list.txt'), 'utf8')).toBe('a\nb\n')
        expect(existsSync(join(workDir, 'Exports', '2026', 'list.txt.rerun-part'))).toBe(false)
    })

    it('says what is missing, and refuses a folder where a file is expected', async () => {
        await expect(files.read('nope.txt', 10, inWorkDir)).rejects.toMatchObject({ code: 'not_found' })
        await expect(files.list('nope', inWorkDir)).rejects.toMatchObject({ code: 'not_found' })
        await expect(files.read('.', 10, inWorkDir)).rejects.toMatchObject({ code: 'invalid' })
        await expect(files.list('notes été.txt', inWorkDir)).rejects.toMatchObject({ code: 'invalid' })
    })

    it('hands a file out in pieces, with the sha256 of the whole on the last one', async () => {
        const big = Buffer.alloc(2.5 * 1024 * 1024, 3)
        writeFileSync(join(workDir, 'big.bin'), big)
        const pieces: Buffer[] = []
        let offset = 0
        for (;;) {
            const piece = await files.pull('big.bin', offset, inWorkDir)
            pieces.push(Buffer.from(piece.data, 'base64'))
            offset += pieces.at(-1)!.length
            if (piece.eof) {
                expect(piece.sha256).toBe(sha(big))
                break
            }
            expect(piece.sha256).toBeNull()
        }
        expect(pieces).toHaveLength(3)
        expect(Buffer.concat(pieces).equals(big)).toBe(true)
    })

    it('takes a file in pieces, renames it into place once its sha256 matches, and drops a damaged one', async () => {
        const data = Buffer.from('teaser bytes')
        expect(await files.push({ path: 'in/teaser.mp4', offset: 0, data: data.subarray(0, 5).toString('base64'), final: false, overwrite: false }, inWorkDir)).toMatchObject({ done: false, size: 5 })
        expect(existsSync(join(workDir, 'in', 'teaser.mp4'))).toBe(false)
        expect(await files.push({ path: 'in/teaser.mp4', offset: 5, data: data.subarray(5).toString('base64'), final: true, sha256: sha(data), overwrite: false }, inWorkDir)).toMatchObject({ done: true, size: data.length })
        expect(readFileSync(join(workDir, 'in', 'teaser.mp4')).equals(data)).toBe(true)

        await expect(files.push({ path: 'in/teaser.mp4', offset: 0, data: 'eA==', final: true, overwrite: false }, inWorkDir)).rejects.toMatchObject({ code: 'busy' })
        await expect(files.push({ path: 'in/bad.mp4', offset: 0, data: data.toString('base64'), final: true, sha256: sha(Buffer.from('other')), overwrite: false }, inWorkDir)).rejects.toMatchObject({ code: 'invalid' })
        expect(existsSync(join(workDir, 'in', 'bad.mp4'))).toBe(false)
        expect(existsSync(join(workDir, 'in', 'bad.mp4.rerun-part'))).toBe(false)
        await expect(files.push({ path: 'in/lost.mp4', offset: 7, data: 'eA==', final: false, overwrite: false }, inWorkDir)).rejects.toMatchObject({ code: 'invalid' })
    })
})
