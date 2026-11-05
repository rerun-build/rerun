import { mkdtempSync } from 'node:fs'
import { chmod, lstat, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-store-'))
process.env.RERUN_DATA_DIR = dataDir

const { beforeAll, describe, expect, it } = await import('vitest')
const store = await import('./store.js')

const root = resolve(dataDir, 'root')

describe('files store', () => {
    it('round-trips text and bytes', async () => {
        await store.writeText(root, 'a/b.txt', 'hello')
        expect(await store.readText(root, 'a/b.txt')).toBe('hello')
        await store.writeBytes(root, 'a/c.bin', new Uint8Array([1, 2, 3]))
        expect(Array.from(new Uint8Array(await new Response(await store.readByteStream(root, 'a/c.bin')).arrayBuffer()))).toEqual([1, 2, 3])
        expect(await store.fileSize(root, 'a/c.bin')).toBe(3)
    })

    it('lists entries with type and metadata', async () => {
        const entries = await store.listEntries(root, 'a')
        const names = entries.map(e => e.name)
        expect(names).toContain('b.txt')
        expect(entries.find(e => e.name === 'b.txt')?.type).toBe('file')
    })

    it('returns empty list for a missing directory', async () => {
        expect(await store.listEntries(root, 'does-not-exist')).toEqual([])
    })

    it('moves and removes entries', async () => {
        await store.move(root, 'a/b.txt', 'a/renamed.txt')
        expect(await store.readText(root, 'a/renamed.txt')).toBe('hello')
        await store.remove(root, 'a/renamed.txt')
        expect(await store.listEntries(root, 'a')).not.toContainEqual(expect.objectContaining({ name: 'renamed.txt' }))
    })

    it('throws on paths escaping the root', async () => {
        await expect(store.readText(root, '../../etc/passwd')).rejects.toThrow('Path escapes the root')
        await expect(store.writeText(root, '../escape.txt', 'x')).rejects.toThrow('Path escapes the root')
    })

    it('overwrites an existing file without leaving a temp file behind', async () => {
        await store.writeText(root, 'atomic/note.txt', 'first')
        await store.writeText(root, 'atomic/note.txt', 'second')
        expect(await store.readText(root, 'atomic/note.txt')).toBe('second')
        expect(await readdir(resolve(root, 'atomic'))).toEqual(['note.txt'])
    })

    it('keeps the executable bit of an existing file', async () => {
        await store.writeText(root, 'atomic/run.sh', 'echo old')
        await chmod(resolve(root, 'atomic/run.sh'), 0o755)
        await store.writeText(root, 'atomic/run.sh', 'echo new')
        const info = await stat(resolve(root, 'atomic/run.sh'))
        expect(info.mode & 0o111).toBe(0o111)
    })

    it('writes through a symlink instead of replacing it', async () => {
        await mkdir(resolve(root, 'linked'), { recursive: true })
        await writeFile(resolve(root, 'linked/target.txt'), 'old')
        await symlink(resolve(root, 'linked/target.txt'), resolve(root, 'linked/alias.txt'))
        await store.writeText(root, 'linked/alias.txt', 'new')
        expect((await lstat(resolve(root, 'linked/alias.txt'))).isSymbolicLink()).toBe(true)
        expect(await store.readText(root, 'linked/target.txt')).toBe('new')
    })

    it('searches file contents with path:line output', async () => {
        await store.writeText(root, 'src/x.txt', 'nothing\nTODO: fix\n')
        const hits = await store.searchText(root, '.', 'TODO', 50)
        expect(hits.some(h => h.includes('src/x.txt:2:') && h.includes('TODO: fix'))).toBe(true)
    })
})

// `outside/` sits next to `root/`: `links/dir` points at it and `links/file` at the file in it.
describe('symlinks', () => {
    const outside = resolve(dataDir, 'outside')
    const bytes = () => new ReadableStream<Uint8Array>({ start: c => (c.enqueue(new Uint8Array([1])), c.close()) })

    beforeAll(async () => {
        await mkdir(outside, { recursive: true })
        await writeFile(resolve(outside, 'secret.txt'), 'TOP SECRET')
        await mkdir(resolve(root, 'links'), { recursive: true })
        await writeFile(resolve(root, 'links/own.txt'), 'mine')
        await symlink(outside, resolve(root, 'links/dir'))
        await symlink(resolve(outside, 'secret.txt'), resolve(root, 'links/file'))
    })

    it.each<[string, () => Promise<unknown>]>([
        ['readText through a file link', () => store.readText(root, 'links/file')],
        ['readText through a folder link', () => store.readText(root, 'links/dir/secret.txt')],
        ['readByteStream', () => store.readByteStream(root, 'links/file')],
        ['listEntries', () => store.listEntries(root, 'links/dir')],
        ['fileSize', () => store.fileSize(root, 'links/file')],
        ['stat', () => store.stat(root, 'links/dir/secret.txt')],
        ['searchText', () => store.searchText(root, 'links/dir', 'SECRET', 10)],
        ['writeText through a file link', () => store.writeText(root, 'links/file', 'overwritten')],
        ['writeText under a folder link', () => store.writeText(root, 'links/dir/pwned.txt', 'x')],
        ['writeBytes', () => store.writeBytes(root, 'links/dir/pwned.bin', new Uint8Array([1]))],
        ['writeStream', () => store.writeStream(root, 'links/dir/pwned.up', bytes(), 100)],
        ['ensureDir', () => store.ensureDir(root, 'links/dir/new')],
        ['move out of the link', () => store.move(root, 'links/dir/secret.txt', 'stolen.txt')],
        ['move into the link', () => store.move(root, 'links/own.txt', 'links/dir/moved.txt')],
    ])('%s refuses a link that leaves the root', async (_label, run) => {
        await expect(run()).rejects.toThrow('Path escapes the root')
        expect(await readdir(outside)).toEqual(['secret.txt'])
        expect(await readFile(resolve(outside, 'secret.txt'), 'utf8')).toBe('TOP SECRET')
    })

    it('removes an outgoing link itself and leaves its target alone', async () => {
        await symlink(resolve(outside, 'secret.txt'), resolve(root, 'links/doomed'))
        await store.remove(root, 'links/doomed')
        expect(await lstat(resolve(root, 'links/doomed')).catch(() => null)).toBeNull()
        expect(await readFile(resolve(outside, 'secret.txt'), 'utf8')).toBe('TOP SECRET')
    })

    it('moves an outgoing link itself and leaves its target alone', async () => {
        await symlink(outside, resolve(root, 'links/dir-moving'))
        await store.move(root, 'links/dir-moving', 'links/dir-moved')
        expect((await lstat(resolve(root, 'links/dir-moved'))).isSymbolicLink()).toBe(true)
        expect(await readdir(outside)).toEqual(['secret.txt'])
    })
})
