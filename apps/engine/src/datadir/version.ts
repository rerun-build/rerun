import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { dataDir, dataVersionPath } from '../config/paths.js'
import { buildCommit } from '../runtime/build-info.js'
import { nowIso } from '../lib/ids.js'
import { logger } from '../lib/logger.js'

const dataVersionSchema = z.object({ version: z.number().int().nonnegative(), commit: z.string().nullable(), migratedAt: z.string() })

export function readDataVersion(): number {
    const path = dataVersionPath()
    if (!existsSync(path)) return 0
    try {
        return dataVersionSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).version
    } catch (err) {
        logger.warn({ path, err: String(err) }, 'unreadable data-version file, treating the data-dir as v0')
        return 0
    }
}

export async function writeDataVersion(version: number): Promise<void> {
    await mkdir(dataDir(), { recursive: true })
    const target = dataVersionPath()
    const tmp = `${target}.tmp`
    await writeFile(tmp, `${JSON.stringify({ version, commit: buildCommit(), migratedAt: nowIso() }, null, 4)}\n`, 'utf8')
    await rename(tmp, target)
}
