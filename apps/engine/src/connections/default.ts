import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { boxDefaultModelSchema, type BoxDefaultModel } from '@moldwright/contracts'
import { boxDefaultPath, connectionsDir } from '../config/paths.js'
import { clearAgentCache } from '../agents/registry.js'

let cached: BoxDefaultModel | null | undefined

export async function readBoxDefault(): Promise<BoxDefaultModel | null> {
    if (cached !== undefined) return cached
    const path = boxDefaultPath()
    if (!existsSync(path)) return (cached = null)
    try {
        cached = boxDefaultModelSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch {
        cached = null
    }
    return cached
}

async function commit(next: BoxDefaultModel | null): Promise<void> {
    cached = next
    clearAgentCache()
}

export async function writeBoxDefault(next: BoxDefaultModel): Promise<BoxDefaultModel> {
    await mkdir(connectionsDir(), { recursive: true })
    const target = boxDefaultPath()
    const tmp = `${target}.tmp`
    await writeFile(tmp, `${JSON.stringify(next, null, 4)}\n`, 'utf8')
    await rename(tmp, target)
    await commit(next)
    return next
}

export async function clearBoxDefault(): Promise<void> {
    await rm(boxDefaultPath(), { force: true })
    await commit(null)
}
