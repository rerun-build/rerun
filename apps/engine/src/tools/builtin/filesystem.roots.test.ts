import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-fs-roots-'))
const jobs = mkdtempSync(resolve(tmpdir(), 'rerun-fs-jobs-'))
const outside = mkdtempSync(resolve(tmpdir(), 'rerun-fs-outside-'))
process.env.RERUN_DATA_DIR = dataDir
process.env.RERUN_FS_EXTRA_ROOTS = jobs

const { describe, expect, it, beforeAll } = await import('vitest')
const { filesystemTools } = await import('./filesystem.js')
const { workspaceDir } = await import('../../config/paths.js')

const ctxFor = (id: string, shell: boolean) => ({ agent: { id, config: { tools: { shell } } } }) as any
const withShell = filesystemTools(ctxFor('builder', true))
const withoutShell = filesystemTools(ctxFor('writer', false))
const job = resolve(jobs, 'repo', 'job-1')

function run(tools: typeof withShell, name: string, args: Record<string, unknown>): Promise<string> {
    return (tools[name] as any).execute(args, {} as any)
}

beforeAll(async () => {
    await mkdir(job, { recursive: true })
    await mkdir(workspaceDir('builder'), { recursive: true })
    await writeFile(resolve(outside, 'secret.txt'), 'secret', 'utf8')
    await symlink(outside, resolve(job, 'link-out'), 'junction')
})

describe('fs tools with extra roots for a coworker with the shell on', () => {
    it('writes, reads, edits, lists and searches a job folder by absolute path', async () => {
        const file = resolve(job, 'src', 'a.ts')
        await run(withShell, 'fs_write', { path: file, content: 'const a = 1\n' })
        expect(await readFile(file, 'utf8')).toBe('const a = 1\n')
        expect(await run(withShell, 'fs_edit', { path: file, oldString: '1', newString: '2', replaceAll: false })).toContain('Edited')
        expect(await run(withShell, 'fs_read', { path: file })).toBe('const a = 2\n')
        expect(await run(withShell, 'fs_list', { path: resolve(job, 'src') })).toBe('a.ts')
        expect(await run(withShell, 'fs_search', { path: job, pattern: 'const a', maxResults: 10 })).toBe(`${file}:1: const a = 2`)
    })

    it('still reads a relative path in the workspace', async () => {
        await run(withShell, 'fs_write', { path: 'note.txt', content: 'mine' })
        expect(await readFile(resolve(workspaceDir('builder'), 'note.txt'), 'utf8')).toBe('mine')
    })

    it('refuses an absolute path outside every root', async () => {
        await expect(run(withShell, 'fs_read', { path: resolve(outside, 'secret.txt') })).rejects.toThrow('escapes the root')
    })

    it('refuses a path that climbs out of the job folder', async () => {
        await expect(run(withShell, 'fs_write', { path: `${job}/../../../${outside.split(/[\\/]/).pop()}/x.txt`, content: 'x' })).rejects.toThrow('escapes the root')
    })

    it('refuses a symlink in the job folder that points outside it', async () => {
        await expect(run(withShell, 'fs_read', { path: resolve(job, 'link-out', 'secret.txt') })).rejects.toThrow('escapes the root')
    })

    it('tells the model the job folders are allowed', () => {
        expect((withShell.fs_write as any).description).toContain(jobs)
    })
})

describe('fs tools for a coworker without the shell', () => {
    it('keeps the workspace as the only root', async () => {
        await expect(run(withoutShell, 'fs_write', { path: resolve(job, 'b.txt'), content: 'x' })).rejects.toThrow('escapes the root')
        expect((withoutShell.fs_write as any).description).not.toContain(jobs)
    })
})
