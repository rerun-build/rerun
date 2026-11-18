import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-boxbackups-'))

const { beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, writeFile } = await import('node:fs/promises')
const { boxBackupsPath, connectionsDir } = await import('../config/paths.js')
const { clearBoxBackups, dropConnectionBackups, readBoxBackups, writeBoxBackups } = await import('./backups.js')

const NONE = { backups: [], rerunCreditLastResort: false }

beforeEach(async () => {
    await clearBoxBackups()
})

describe('box backups storage', () => {
    it('answers no backup on a box that never set one', async () => {
        expect(await readBoxBackups()).toEqual(NONE)
    })

    it('round trips the list in its order', async () => {
        const next = {
            backups: [
                { connectionId: 'cnx-2', model: 'gpt-6-sol' },
                { connectionId: 'cnx-1', model: 'opus' },
            ],
            rerunCreditLastResort: true,
        }
        await writeBoxBackups(next)
        expect(await readBoxBackups()).toEqual(next)
    })

    it('drops the entries of one connection only', async () => {
        await writeBoxBackups({
            backups: [
                { connectionId: 'cnx-1', model: 'opus' },
                { connectionId: 'cnx-2', model: 'gpt-6-sol' },
                { connectionId: 'cnx-1', model: 'sonnet' },
            ],
            rerunCreditLastResort: false,
        })
        await dropConnectionBackups('cnx-1')
        expect(await readBoxBackups()).toEqual({ backups: [{ connectionId: 'cnx-2', model: 'gpt-6-sol' }], rerunCreditLastResort: false })
    })

    // An unreadable list fails runs exactly as they failed before backups existed.
    it('reads a corrupt file as no backup at all', async () => {
        await mkdir(connectionsDir(), { recursive: true })
        await writeFile(boxBackupsPath(), '{ not json', 'utf8')
        await clearBoxBackups()
        await writeFile(boxBackupsPath(), '{ not json', 'utf8')
        expect(await readBoxBackups()).toEqual(NONE)
    })
})
