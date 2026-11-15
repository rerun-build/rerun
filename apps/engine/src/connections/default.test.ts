import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-boxdefault-'))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, rm, writeFile } = await import('node:fs/promises')
const { boxDefaultPath, connectionsDir } = await import('../config/paths.js')
const { clearBoxDefault, readBoxDefault, writeBoxDefault } = await import('./default.js')

beforeEach(async () => {
    await clearBoxDefault()
    await rm(connectionsDir(), { recursive: true, force: true })
})

describe('box default storage', () => {
    it('answers null before anyone sets one', async () => {
        expect(await readBoxDefault()).toBeNull()
    })

    it('round trips the pair', async () => {
        await writeBoxDefault({ connectionId: 'cnx-1', model: 'opus' })
        expect(await readBoxDefault()).toEqual({ connectionId: 'cnx-1', model: 'opus' })
    })

    it('clears back to nothing', async () => {
        await writeBoxDefault({ connectionId: 'cnx-1', model: 'opus' })
        await clearBoxDefault()
        expect(await readBoxDefault()).toBeNull()
    })

    it('reads a corrupt file as no default at all', async () => {
        await mkdir(connectionsDir(), { recursive: true })
        await writeFile(boxDefaultPath(), '{ not json', 'utf8')
        await clearBoxDefault()
        await writeFile(boxDefaultPath(), '{ not json', 'utf8')
        expect(await readBoxDefault()).toBeNull()
    })
})
