import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-fs-'))
process.env.RERUN_DATA_DIR = dataDir

const { describe, expect, it, beforeAll } = await import('vitest')
const { filesystemTools } = await import('./filesystem.js')
const { workspaceDir } = await import('../../config/paths.js')

const id = 'testagent'
const ctx = { agent: { id, config: { tools: { shell: false } } } } as any
const tools = filesystemTools(ctx)
const ws = workspaceDir(id)

async function run(name: string, args: Record<string, unknown>): Promise<string> {
    return (await (tools[name] as any).execute(args, {} as any)) as string
}

beforeAll(async () => {
    await mkdir(resolve(ws, 'sub'), { recursive: true })
    await writeFile(resolve(ws, 'a.txt'), 'hello world\nfoo bar\nhello again\n', 'utf8')
    await writeFile(resolve(ws, 'sub', 'b.txt'), 'TODO: fix this\nnothing here\n', 'utf8')
})

describe('fs_edit', () => {
    it('replaces a unique match', async () => {
        const res = await run('fs_edit', { path: 'a.txt', oldString: 'foo bar', newString: 'baz qux' })
        expect(res).toContain('Edited')
        expect(await readFile(resolve(ws, 'a.txt'), 'utf8')).toContain('baz qux')
    })

    it('rejects a non-unique match without replaceAll', async () => {
        const res = await run('fs_edit', { path: 'a.txt', oldString: 'hello', newString: 'hi', replaceAll: false })
        expect(res).toContain('matches 2 times')
    })

    it('replaces all occurrences with replaceAll', async () => {
        const res = await run('fs_edit', { path: 'a.txt', oldString: 'hello', newString: 'hi', replaceAll: true })
        expect(res).toContain('2 replacements')
        const content = await readFile(resolve(ws, 'a.txt'), 'utf8')
        expect(content).not.toContain('hello')
    })

    it('reports when the string is absent', async () => {
        const res = await run('fs_edit', { path: 'a.txt', oldString: 'does-not-exist', newString: 'x', replaceAll: false })
        expect(res).toContain('not found')
    })
})

describe('fs_search', () => {
    it('finds matches across nested files with path:line output', async () => {
        const res = await run('fs_search', { path: '.', pattern: 'TODO', maxResults: 200 })
        expect(res).toContain('sub/b.txt:1:')
        expect(res).toContain('TODO: fix this')
    })

    it('reports no matches', async () => {
        const res = await run('fs_search', { path: '.', pattern: 'zzz-not-present', maxResults: 200 })
        expect(res).toBe('No matches.')
    })

    it('rejects an invalid regular expression', async () => {
        const res = await run('fs_search', { path: '.', pattern: '(', maxResults: 200 })
        expect(res).toContain('Invalid regular expression')
    })
})
