import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-boxdefault-gaps-'))
process.env.RERUN_API_KEY = ''

const { beforeEach, describe, expect, it, vi } = await import('vitest')
const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
const { agentDir, boxDefaultPath, connectionsDir } = await import('../config/paths.js')

async function boot() {
    vi.resetModules()
    return import('./default.js')
}

async function onDisk(content: string): Promise<void> {
    await mkdir(connectionsDir(), { recursive: true })
    await writeFile(boxDefaultPath(), content, 'utf8')
}

beforeEach(async () => {
    await rm(connectionsDir(), { recursive: true, force: true })
})

describe('readBoxDefault on boot', () => {
    it('reads the pair a previous process wrote', async () => {
        await onDisk(JSON.stringify({ connectionId: 'cnx-1', model: 'opus' }))
        const { readBoxDefault } = await boot()
        expect(await readBoxDefault()).toEqual({ connectionId: 'cnx-1', model: 'opus' })
    })

    it('reads a corrupt file as no default at all', async () => {
        await onDisk('{ not json')
        const { readBoxDefault } = await boot()
        expect(await readBoxDefault()).toBeNull()
    })

    it('reads a file with the wrong shape as no default at all', async () => {
        await onDisk(JSON.stringify({ connectionId: 42 }))
        const { readBoxDefault } = await boot()
        expect(await readBoxDefault()).toBeNull()
    })

    it('holds what it read rather than going back to disk', async () => {
        const { readBoxDefault } = await boot()
        expect(await readBoxDefault()).toBeNull()

        await onDisk(JSON.stringify({ connectionId: 'cnx-2', model: 'sonnet' }))

        expect(await readBoxDefault()).toBeNull()
    })
})

describe('writeBoxDefault', () => {
    it('writes a file the next process reads back, and leaves no temp file behind', async () => {
        const first = await boot()
        await first.writeBoxDefault({ connectionId: 'cnx-3', model: 'gpt-5' })

        expect(JSON.parse(await readFile(boxDefaultPath(), 'utf8'))).toEqual({ connectionId: 'cnx-3', model: 'gpt-5' })
        await expect(readFile(`${boxDefaultPath()}.tmp`, 'utf8')).rejects.toThrow()

        const second = await boot()
        expect(await second.readBoxDefault()).toEqual({ connectionId: 'cnx-3', model: 'gpt-5' })
    })

    it('drops the cached agents so the next lookup resolves against the new default', async () => {
        const { writeBoxDefault, clearBoxDefault } = await boot()
        const { getAgent } = await import('../agents/registry.js')
        const { writeAgentConfig } = await import('../agents/config-write.js')
        const { agentConfigSchema } = await import('../agents/types.js')
        await mkdir(agentDir('defaultgaps'), { recursive: true })
        await writeAgentConfig('defaultgaps', agentConfigSchema.parse({ name: 'x' }))

        const before = await getAgent('defaultgaps')
        expect(await getAgent('defaultgaps')).toBe(before)

        await writeBoxDefault({ connectionId: 'cnx-4', model: 'opus' })
        const afterWrite = await getAgent('defaultgaps')
        expect(afterWrite).not.toBe(before)

        await clearBoxDefault()
        expect(await getAgent('defaultgaps')).not.toBe(afterWrite)
    })
})
