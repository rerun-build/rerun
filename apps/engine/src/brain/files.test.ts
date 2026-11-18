import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-brain-files-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeEach } = await import('vitest')
const { mkdir, writeFile } = await import('node:fs/promises')
const { sharedDir } = await import('../config/paths.js')
const { getBrainDb } = await import('../db/brainDb.js')
const files = await import('./files.js')
const { agentSpaceId, setAgentBoxes } = await import('./boxes.js')

async function touch(path: string) {
    const full = resolve(sharedDir(), path)
    await mkdir(resolve(full, '..'), { recursive: true })
    await writeFile(full, 'x')
}

beforeEach(async () => {
    const client = await getBrainDb()
    await client.execute('DELETE FROM brain_files')
})

describe('filing the shared folder', () => {
    it('files an import: tags and Box on every path, the person as author, the folder as one', async () => {
        await touch('brand-kit/logo.svg')
        await touch('brand-kit/fonts/Inter.ttf')
        await files.setFileMeta({ paths: ['brand-kit', './brand-kit/logo.svg', 'brand-kit/fonts/Inter.ttf'], tags: ['#Brand'], spaceId: 'box-marketing', author: 'user:theo' })
        expect(await files.listFileMeta()).toEqual([
            expect.objectContaining({ path: 'brand-kit', tags: ['brand'], spaceId: 'box-marketing', createdBy: 'user:theo' }),
            expect.objectContaining({ path: 'brand-kit/fonts/Inter.ttf' }),
            expect.objectContaining({ path: 'brand-kit/logo.svg' }),
        ])
    })

    it('changes only what is sent, and keeps the first author', async () => {
        await touch('pipeline.csv')
        await files.setFileMeta({ paths: ['pipeline.csv'], tags: ['pipeline'], spaceId: 'box-sales', author: 'user:theo' })
        await files.setFileMeta({ paths: ['pipeline.csv'], spaceId: null, author: 'user:clement' })
        expect(await files.listFileMeta()).toEqual([expect.objectContaining({ path: 'pipeline.csv', tags: ['pipeline'], spaceId: null, createdBy: 'user:theo' })])
    })

    it('keeps a coworker as the author of a file it wrote, without overwriting a filed one', async () => {
        await touch('notes.md')
        await files.recordFileCreated('notes.md', 'agent:scout', 'box-sales')
        await files.recordFileCreated('notes.md', 'agent:other', null)
        expect(await files.listFileMeta()).toEqual([expect.objectContaining({ path: 'notes.md', createdBy: 'agent:scout', spaceId: 'box-sales' })])
    })

    it('follows a folder that moves and forgets one that is deleted, without touching a neighbour with the same prefix', async () => {
        await touch('acme/contract.pdf')
        await touch('acme-old/contract.pdf')
        await files.setFileMeta({ paths: ['acme', 'acme/contract.pdf', 'acme-old/contract.pdf'], tags: ['acme'] })
        await files.moveFileMeta('acme', 'clients/acme')
        await touch('clients/acme/contract.pdf')
        expect((await files.listFileMeta()).map(file => file.path)).toEqual(['acme-old/contract.pdf', 'clients/acme', 'clients/acme/contract.pdf'])
        await files.removeFileMeta('clients/acme')
        expect((await files.listFileMeta()).map(file => file.path)).toEqual(['acme-old/contract.pdf'])
    })

    it('says whether a filed path is a folder, even with nothing filed inside it', async () => {
        await touch('contracts/2024/acme.pdf')
        await touch('pricing.pdf')
        await files.setFileMeta({ paths: ['contracts', 'pricing.pdf'], spaceId: 'box-sales' })
        expect((await files.listFileMeta()).map(({ path, kind }) => ({ path, kind }))).toEqual([
            { path: 'contracts', kind: 'dir' },
            { path: 'pricing.pdf', kind: 'file' },
        ])
    })

    it('never files a path outside the shared folder, nor the folder itself', async () => {
        await files.setFileMeta({ paths: ['../../etc/hostname', '.', 'a/../../b'], tags: ['x'] })
        await files.recordFileCreated('../outside.md', 'agent:scout', null)
        const client = await getBrainDb()
        expect((await client.execute('SELECT count(*) AS n FROM brain_files')).rows[0].n).toBe(0)
    })

    it('hides a path whose file is not there yet, and forgets it only after a day', async () => {
        await files.setFileMeta({ paths: ['incoming.pdf'], tags: ['x'] })
        expect(await files.listFileMeta()).toEqual([])
        const client = await getBrainDb()
        expect((await client.execute("SELECT count(*) AS n FROM brain_files WHERE path = 'incoming.pdf'")).rows[0].n).toBe(1)
        await client.execute("UPDATE brain_files SET created_at = '2020-01-01T00:00:00.000Z' WHERE path = 'incoming.pdf'")
        await files.listFileMeta()
        expect((await client.execute("SELECT count(*) AS n FROM brain_files WHERE path = 'incoming.pdf'")).rows[0].n).toBe(0)
    })
})

describe('the Boxes of the coworkers', () => {
    it('replaces the whole map each time the hub sends it', async () => {
        await setAgentBoxes({ a1: 'box-sales', a2: 'box-support' })
        await setAgentBoxes({ a1: 'box-marketing' })
        expect(await agentSpaceId('a1')).toBe('box-marketing')
        expect(await agentSpaceId('a2')).toBeNull()
    })
})
