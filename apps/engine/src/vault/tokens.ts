import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { isPathSegment, vaultItemPath, vaultTokenPath, vaultTokensDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import type { StoredToken } from '../tools/mcp-auth.js'

// One token per item and server, whatever the number of coworkers drawing on it: a single refresh
// lineage, so two runs never rotate the same refresh token against each other.
export async function saveVaultToken(itemId: string, server: string, token: StoredToken): Promise<void> {
    // A refresh landing after the item was deleted must not bring its folder back with a live token.
    if (!existsSync(vaultItemPath(itemId))) return
    await mkdir(vaultTokensDir(itemId), { recursive: true, mode: 0o700 })
    await writeFileAtomic(vaultTokenPath(itemId, server), JSON.stringify(token, null, 4), { mode: 0o600 })
}

export async function loadVaultToken(itemId: string, server: string): Promise<StoredToken | null> {
    if (!isPathSegment(server)) return null
    const path = vaultTokenPath(itemId, server)
    if (!existsSync(path)) return null
    try {
        return JSON.parse(await readFile(path, 'utf8')) as StoredToken
    } catch {
        return null
    }
}

export async function clearVaultToken(itemId: string, server: string): Promise<void> {
    if (!isPathSegment(server)) return
    await rm(vaultTokenPath(itemId, server), { force: true })
}

export async function listVaultTokenServers(itemId: string): Promise<string[]> {
    const dir = vaultTokensDir(itemId)
    if (!existsSync(dir)) return []
    const names = await readdir(dir)
    return names
        .filter(name => name.endsWith('.json') && !name.endsWith('.tmp'))
        .map(name => name.slice(0, -'.json'.length))
        .sort()
}
