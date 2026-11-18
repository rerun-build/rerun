import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { NO_BOX_BACKUPS, boxBackupsSchema, type BoxBackups } from '@rerun/contracts'
import { boxBackupsPath, connectionsDir } from '../config/paths.js'

// Read once and held, like the box default: every write goes through this module. A missing file is
// a box that set no backup, which is every box until someone adds one.
let cached: BoxBackups | undefined

export async function readBoxBackups(): Promise<BoxBackups> {
    if (cached) return cached
    const path = boxBackupsPath()
    if (!existsSync(path)) return (cached = NO_BOX_BACKUPS)
    try {
        cached = boxBackupsSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch {
        // An unreadable list fails runs exactly as they failed before backups existed.
        cached = NO_BOX_BACKUPS
    }
    return cached
}

// One write at a time: two sharing the temporary file could leave on disk a list other than the one
// held in memory.
let writing: Promise<unknown> = Promise.resolve()

export async function writeBoxBackups(next: BoxBackups): Promise<BoxBackups> {
    const write = writing.then(async () => {
        await mkdir(connectionsDir(), { recursive: true })
        const target = boxBackupsPath()
        const tmp = `${target}.tmp`
        await writeFile(tmp, `${JSON.stringify(next, null, 4)}\n`, 'utf8')
        await rename(tmp, target)
        cached = next
        return next
    })
    writing = write.catch(() => {})
    return write
}

export async function dropConnectionBackups(connectionId: string): Promise<void> {
    const current = await readBoxBackups()
    const backups = current.backups.filter(backup => backup.connectionId !== connectionId)
    if (backups.length !== current.backups.length) await writeBoxBackups({ ...current, backups })
}

export async function clearBoxBackups(): Promise<void> {
    await rm(boxBackupsPath(), { force: true })
    cached = NO_BOX_BACKUPS
}
