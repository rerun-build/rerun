import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-fstools-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { z } = await import('zod')
const { makeFsTools } = await import('./fsTools.js')

const root = mkdtempSync(resolve(tmpdir(), 'rerun-fstools-root-'))
mkdirSync(resolve(root, 'empty'))
mkdirSync(resolve(root, 'nested/deeper'), { recursive: true })
writeFileSync(resolve(root, 'nested/a.txt'), 'alpha\n')
writeFileSync(resolve(root, 'big.txt'), 'x'.repeat(150_000))
writeFileSync(resolve(root, 'many.txt'), Array.from({ length: 10 }, (_, i) => `hit ${i}`).join('\n'))
writeFileSync(resolve(root, 'same.txt'), 'keep me')
writeFileSync(resolve(root, 'lines.txt'), Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')

const tools = makeFsTools({ prefix: 'box', label: 'test root', rootDir: root })

async function run(name: string, args: Record<string, unknown>): Promise<string> {
    return (await (tools[name] as any).execute(args, { toolCallId: 'c', messages: [] })) as string
}

describe('makeFsTools', () => {
    it('names every tool with the prefix and the label in its description', () => {
        expect(Object.keys(tools)).toEqual(['box_read', 'box_write', 'box_list', 'box_edit', 'box_search'])
        expect(tools.box_read.description).toContain('test root')
        expect(tools.box_edit.description).toContain('box_write')
    })

    it('caps a read at 100k characters', async () => {
        expect(await run('box_read', { path: 'big.txt' })).toHaveLength(100_000)
    })

    it('reads lines 400 to 420 exactly', async () => {
        const out = await run('box_read', { path: 'lines.txt', startLine: 400, endLine: 420 })
        const expected = ['lines 400-420 of 500', ...Array.from({ length: 21 }, (_, i) => `line ${400 + i}`)]
        expect(out.split('\n')).toEqual(expected)
    })

    it('stops at the last line', async () => {
        const out = await run('box_read', { path: 'lines.txt', startLine: 498, endLine: 900 })
        expect(out).toBe('lines 498-500 of 500\nline 498\nline 499\nline 500')
    })

    it('answers an error past the end', async () => {
        const out = await run('box_read', { path: 'lines.txt', startLine: 501 })
        expect(out).toContain('501')
        expect(out).toContain('500')
        expect(out).not.toContain('line 500')
    })

    it('reads the whole file without a range, as today', async () => {
        expect(await run('box_read', { path: 'same.txt' })).toBe('keep me')
        expect(await run('box_read', { path: 'big.txt' })).toHaveLength(100_000)
    })

    it('reports the size it wrote and creates parent folders', async () => {
        expect(await run('box_write', { path: 'new/dir/file.md', content: 'hello' })).toBe('Wrote 5 bytes to new/dir/file.md')
        expect(await readFile(resolve(root, 'new/dir/file.md'), 'utf8')).toBe('hello')
    })

    it('lists folders with a trailing slash and says when a folder is empty', async () => {
        expect((await run('box_list', { path: 'nested' })).split('\n').sort()).toEqual(['a.txt', 'deeper/'])
        expect(await run('box_list', { path: 'empty' })).toBe('(empty)')
    })

    it('says a missing file cannot be edited', async () => {
        expect(await run('box_edit', { path: 'ghost.txt', oldString: 'a', newString: 'b', replaceAll: false })).toBe('File not found: ghost.txt')
    })

    it('does nothing when both strings are identical', async () => {
        expect(await run('box_edit', { path: 'same.txt', oldString: 'keep', newString: 'keep', replaceAll: false })).toBe('oldString and newString are identical; nothing to do.')
        expect(await readFile(resolve(root, 'same.txt'), 'utf8')).toBe('keep me')
    })

    it('says a single replacement without a plural', async () => {
        expect(await run('box_edit', { path: 'same.txt', oldString: 'me', newString: 'you', replaceAll: false })).toBe('Edited same.txt (1 replacement)')
    })

    it('says a missing search folder is missing', async () => {
        expect(await run('box_search', { pattern: 'x', path: 'nowhere', maxResults: 10 })).toBe('Path not found: nowhere')
    })

    it('notes when the results hit the cap', async () => {
        const out = await run('box_search', { pattern: '^hit', path: '.', maxResults: 3 })
        expect(out.split('\n')).toHaveLength(4)
        expect(out).toMatch(/\n\(truncated at 3 results\)$/)
        expect(await run('box_search', { pattern: '^alpha', path: '.', maxResults: 3 })).toBe('nested/a.txt:1: alpha')
    })

    it('refuses a path that leaves the root', async () => {
        await expect(run('box_read', { path: '../outside.txt' })).rejects.toThrow('Path escapes the root')
    })
})

describe('makeFsTools with a root chosen per call', () => {
    const roots: Record<string, string> = { one: mkdtempSync(resolve(tmpdir(), 'rerun-fs-one-')), two: mkdtempSync(resolve(tmpdir(), 'rerun-fs-two-')) }
    const seen: Record<string, unknown>[] = []
    const scoped = makeFsTools({
        prefix: 'pick',
        label: 'picked root',
        scope: { which: z.string() },
        rootDir: async input => {
            seen.push(input)
            return roots[String(input.which)]
        },
    })

    it('resolves the root from the scope field of each call', async () => {
        await (scoped.pick_write as any).execute({ which: 'two', path: 'f.txt', content: 'second' }, {})
        expect(await readFile(resolve(roots.two, 'f.txt'), 'utf8')).toBe('second')
        expect(await (scoped.pick_list as any).execute({ which: 'one', path: '.' }, {})).toBe('(empty)')
        expect(seen[0]).toMatchObject({ which: 'two', path: 'f.txt' })
    })

    it('puts the scope field in every input schema', () => {
        for (const tool of Object.values(scoped)) expect((tool.inputSchema as any).shape.which).toBeDefined()
    })
})
