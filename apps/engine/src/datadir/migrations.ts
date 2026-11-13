import { existsSync } from 'node:fs'
import { chmod, lstat, mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { migrate } from '../db/migrate.js'
import { latestVersion } from '../db/ladder.js'
import { foldAgentKeysIntoConnections } from '../connections/migrate.js'
import { agentsDir, boxPlanPath, configPath, isPathSegment, mcpDir, mcpPackagesDir, vaultDir } from '../config/paths.js'
import { logger } from '../lib/logger.js'
import { adoptConnectors } from '../vault/adopt.js'

const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === 'ENOENT'

async function listDirOrEmpty(dir: string): Promise<string[]> {
    try {
        return await readdir(dir)
    } catch (err) {
        if (!isMissing(err)) logger.warn({ dir, err: (err as Error).message }, 'data-dir migration: folder left unread')
        return []
    }
}

// Checked with lstat first: a link planted among the files must never have its target's mode
// changed. A missing path is nothing to do; any other failure is logged and skipped, so one stray
// file does not keep the engine from booting.
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

// One change to the layout of the data-dir: a file or folder moved, renamed, rewritten, or a schema
// change of `rerun.db`. A shipped step is never edited nor removed, because an archived data-dir may
// come back from before it. `up` must be re-runnable: a crash between the step and the version write
// replays it on the next boot. Per-agent `system.db` and `shared.db` carry their own ladders.
export type DataDirMigration = { version: number; id: string; up: () => Promise<void> }

export const DATA_DIR_MIGRATIONS: DataDirMigration[] = [
    {
        // Everything that existed before the ladder, each piece already idempotent, so a folder that
        // has none of it and one that has all of it both land here safely.
        version: 1,
        id: 'baseline',
        up: async () => {
            await migrate()
            await foldAgentKeysIntoConnections()
        },
    },
    {
        // The plan the hub pushes, written out explicitly for a box that has not heard from it yet.
        // Unrestricted, which is what an engine reads when the file is missing, so a box restored
        // from before this step keeps running whatever its agents asked for until the hub says so.
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
        // Where the MCP packages an agent launches with `npx` are installed once. An engine from
        // before this step never reads it, and one after it fills it on its own.
        version: 3,
        id: 'mcp-packages',
        up: async () => {
            await mkdir(mcpPackagesDir(), { recursive: true })
        },
    },
    {
        // `config.json` (MCP server headers and env) and `mcp/*.json` (OAuth tokens, pending device
        // sign-ins) were written with the default mode, readable by every uid on the box. New writes
        // are 0600 since this step; the files already there are brought to the same mode here.
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
    {
        // The workspace's Vault: accounts and secrets held once on the box and attached to the
        // coworkers that use them. Created empty; an engine from before this step never reads it, so
        // a rollback leaves every coworker on the connectors in its own folder.
        version: 5,
        id: 'vault',
        up: async () => {
            await mkdir(vaultDir(), { recursive: true, mode: 0o700 })
            await chmodRegular(vaultDir(), 0o700, 'dir')
        },
    },
    {
        // Every catalog app a coworker installed in its own folder becomes an item of the Vault
        // attached to it, its keys and tokens copied. Nothing is removed from the coworker's folder:
        // an engine from before the Vault, put back in place, finds every account where it left it.
        // The boot of the engine runs the same adoption again for what was written there since.
        version: 6,
        id: 'vault-adopt',
        up: async () => {
            await mkdir(vaultDir(), { recursive: true, mode: 0o700 })
            await adoptConnectors()
        },
    },
]

export const DATA_DIR_VERSION = latestVersion(DATA_DIR_MIGRATIONS)
