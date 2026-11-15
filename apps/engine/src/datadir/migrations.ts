import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { migrate } from '../db/migrate.js'
import { latestVersion } from '../db/ladder.js'
import { foldAgentKeysIntoConnections } from '../connections/migrate.js'
import { agentsDir, boxPlanPath, configPath, isPathSegment, mcpDir, mcpPackagesDir } from '../config/paths.js'
import { logger } from '../lib/logger.js'

const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === 'ENOENT'

async function listDirOrEmpty(dir: string): Promise<string[]> {
    try {
        return await readdir(dir)
    } catch (err) {
        if (!isMissing(err)) logger.warn({ dir, err: (err as Error).message }, 'data-dir migration: folder left unread')
        return []
    }
}

async function chmodRegular(path: string, mode: number, kind: 'file' | 'dir'): Promise<void> {
    try {
        const info = await lstat(path)
        if (kind === 'file' ? !info.isFile() : !info.isDirectory()) return
        await chmod(path, mode)
    } catch (err) {
        if (!isMissing(err)) logger.warn({ path, err: (err as Error).message }, 'data-dir migration: mode left as is')
    }
}

async function listAgentFolders(): Promise<string[]> {
    const folders: string[] = []
    for (const name of await listDirOrEmpty(agentsDir())) {
        if (!isPathSegment(name)) continue
        const info = await lstat(resolve(agentsDir(), name)).catch(() => null)
        if (info?.isDirectory()) folders.push(name)
    }
    return folders
}

export type DataDirMigration = { version: number; id: string; up: () => Promise<void> }

export const DATA_DIR_MIGRATIONS: DataDirMigration[] = [
    {
        version: 1,
        id: 'baseline',
        up: async () => {
            await migrate()
            await foldAgentKeysIntoConnections()
        },
    },
    {
        version: 2,
        id: 'box-plan',
        up: async () => {
            const target = boxPlanPath()
            if (existsSync(target)) return
            const tmp = `${target}.tmp`
            await writeFile(tmp, `${JSON.stringify({ premiumModels: true }, null, 4)}\n`, 'utf8')
            await rename(tmp, target)
        },
    },
    {
        version: 3,
        id: 'mcp-packages',
        up: async () => {
            await mkdir(mcpPackagesDir(), { recursive: true })
        },
    },
    {
        version: 4,
        id: 'secret-file-modes',
        up: async () => {
            for (const id of await listAgentFolders()) {
                await chmodRegular(configPath(id), 0o600, 'file')
                const mcp = mcpDir(id)
                for (const name of await listDirOrEmpty(mcp)) {
                    if (name.endsWith('.json')) await chmodRegular(resolve(mcp, name), 0o600, 'file')
                }
                await chmodRegular(mcp, 0o700, 'dir')
            }
        },
    },
]

export const DATA_DIR_VERSION = latestVersion(DATA_DIR_MIGRATIONS)
