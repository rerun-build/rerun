import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { mcpTokenPath, vaultDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { logger } from '../lib/logger.js'
import type { StoredToken } from '../tools/mcp-auth.js'

// Which entry of which coworker's own registry became which item of the Vault, and the install it
// was taken from: a detach is never undone by the next boot, and an entry installed again under the
// same key is adopted again. Written by the adoption (`adopt.ts`), read by the token writes.
const adoptedSchema = z.object({
    agents: z.record(z.string(), z.record(z.string(), z.object({ itemId: z.string(), installedAt: z.string().nullable() }))).default({}),
})
export type Adopted = z.infer<typeof adoptedSchema>

const adoptedPath = () => resolve(vaultDir(), 'adopted.json')

export function readAdopted(): Adopted {
    try {
        return adoptedSchema.parse(JSON.parse(readFileSync(adoptedPath(), 'utf8')))
    } catch {
        return { agents: {} }
    }
}

export async function writeAdopted(adopted: Adopted): Promise<void> {
    await writeFileAtomic(adoptedPath(), `${JSON.stringify(adopted, null, 4)}\n`, { mode: 0o600 })
}

// The coworkers an adopted item came from, which still hold their own copy of its tokens.
export function adoptedFrom(itemId: string): string[] {
    return Object.entries(readAdopted().agents).flatMap(([agentId, keys]) => (Object.values(keys).some(record => record.itemId === itemId) ? [agentId] : []))
}

// Until the copies go, every token the Vault obtains for an adopted item is written back into the
// copy it came from: an engine from before the Vault, put back in place, then refreshes a live
// refresh token rather than one the Vault already spent. Never creates a copy that is not there.
export async function writeBackAdoptedToken(itemId: string, server: string, token: StoredToken): Promise<void> {
    for (const agentId of adoptedFrom(itemId)) {
        const path = mcpTokenPath(agentId, server)
        if (!existsSync(path)) continue
        await writeFileAtomic(path, JSON.stringify(token, null, 4), { mode: 0o600 }).catch(err => logger.warn({ agent: agentId, server, err: String(err) }, 'vault adoption: token copy left stale'))
    }
}
