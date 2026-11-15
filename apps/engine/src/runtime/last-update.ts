import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { dataDir, lastUpdatePath } from '../config/paths.js'
import { nowIso } from '../lib/ids.js'
import { buildCommit, isBuildCommit } from './build-info.js'

export const lastUpdateSchema = z.object({
    status: z.enum(['running', 'error', 'restarting', 'success']),
    commit: z.string().nullable(),
    error: z.string().optional(),
    at: z.string(),
})
export type LastUpdate = z.infer<typeof lastUpdateSchema>

export function readLastUpdate(): LastUpdate | null {
    const path = lastUpdatePath()
    if (!existsSync(path)) return null
    try {
        return lastUpdateSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
        return null
    }
}

export function writeLastUpdate(entry: Omit<LastUpdate, 'at'>): LastUpdate {
    const full: LastUpdate = { ...entry, at: nowIso() }
    mkdirSync(dataDir(), { recursive: true })
    const target = lastUpdatePath()
    const tmp = `${target}.tmp`
    writeFileSync(tmp, `${JSON.stringify(full, null, 4)}\n`, 'utf8')
    renameSync(tmp, target)
    return full
}

export function settleLastUpdateOnBoot(): LastUpdate | null {
    const last = readLastUpdate()
    if (!last || last.status !== 'restarting') return last
    if (!last.commit || isBuildCommit(last.commit)) return writeLastUpdate({ status: 'success', commit: last.commit ?? buildCommit() })
    return writeLastUpdate({ status: 'error', commit: last.commit, error: `engine came back on ${buildCommit() ?? 'an unknown commit'} instead of ${last.commit}` })
}
