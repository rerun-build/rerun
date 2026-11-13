import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
    MCP_SERVER_NAME_RE,
    VAULT_REDACTED,
    redactVaultValue,
    vaultItemConfigSchema,
    type CreateVaultItemInput,
    type UpdateVaultItemEnvInput,
    type UpdateVaultItemInput,
    type VaultItemConfig,
    type VaultItemSummary,
    createVaultItemSchema,
    updateVaultItemEnvSchema,
    updateVaultItemSchema,
} from '@rerun/contracts'
import { vaultDir, vaultItemDir, vaultItemEnvPath, vaultItemPath, isPathSegment } from '../config/paths.js'
import { readEnvFile, serializeEnv, writeEnvFile } from '../lib/env-file.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { badRequest, notFound } from '../lib/errors.js'
import { newId, nowIso } from '../lib/ids.js'
import { withKeyedLock } from '../lib/lock.js'
import { logger } from '../lib/logger.js'
import { agentExists, listAgentIdsOnDisk } from '../agents/loader.js'
import { BRIDGE_SERVER_NAME } from '../agents/types.js'
import { findVaultConflicts, VaultConflictError } from './conflicts.js'
import { listVaultTokenServers } from './tokens.js'
import type { LoadedVaultItem } from './types.js'

// Every write that changes who holds what (an item, its servers, its variables, its attachments)
// goes through this one lock: the conflict check reads every other item, and two attachments made
// at once must not both pass it. Tokens have locks of their own, per item and server.
const VAULT_LOCK = 'vault'

export function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
    return withKeyedLock(VAULT_LOCK, fn)
}

const cache = new Map<string, LoadedVaultItem>()
let fullyListed = false

// Dropped by tests and by anything that writes the folder behind the store's back (a migration).
export function forgetVaultCache(): void {
    cache.clear()
    fullyListed = false
}

export function vaultItemExists(id: string): boolean {
    return isPathSegment(id) && existsSync(vaultItemPath(id))
}

async function loadFromDisk(id: string): Promise<LoadedVaultItem> {
    const config = vaultItemConfigSchema.parse(JSON.parse(await readFile(vaultItemPath(id), 'utf8')))
    const env = await readEnvFile(vaultItemEnvPath(id))
    return { id, config, env }
}

async function reload(id: string): Promise<LoadedVaultItem> {
    const item = await loadFromDisk(id)
    cache.set(id, item)
    return item
}

export async function getVaultItem(id: string): Promise<LoadedVaultItem> {
    const cached = cache.get(id)
    if (cached) return cached
    if (!vaultItemExists(id)) throw notFound('vault item')
    return reload(id)
}

// An item the engine cannot read is left out rather than failing the whole list: one hand-edited
// file must not take every other account of the workspace with it.
export async function listVaultItems(): Promise<LoadedVaultItem[]> {
    if (!fullyListed) {
        const root = vaultDir()
        const names = existsSync(root) ? (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name) : []
        cache.clear()
        for (const name of names) {
            if (!vaultItemExists(name)) continue
            try {
                await reload(name)
            } catch (err) {
                logger.warn({ item: name, err: String(err) }, 'vault item left unread')
            }
        }
        fullyListed = true
    }
    return [...cache.values()].sort((a, b) => a.config.createdAt.localeCompare(b.config.createdAt) || a.id.localeCompare(b.id))
}

export function isAttachedTo(item: Pick<LoadedVaultItem, 'config'>, agentId: string): boolean {
    return item.config.sharedWithAll || item.config.agentIds.includes(agentId)
}

// What a coworker draws on from the Vault: the items attached to it and those shared with everyone.
export async function vaultItemsForAgent(agentId: string): Promise<LoadedVaultItem[]> {
    return (await listVaultItems()).filter(item => isAttachedTo(item, agentId))
}

const redactRecord = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, redactVaultValue(value)]))

export async function toVaultSummary(item: LoadedVaultItem): Promise<VaultItemSummary> {
    const mcpServers = item.config.mcpServers.map(server => ({ ...server, env: redactRecord(server.env), headers: redactRecord(server.headers) }))
    return { id: item.id, ...item.config, mcpServers, envKeys: Object.keys(item.env).sort(), tokens: await listVaultTokenServers(item.id) }
}

// The coworkers that would lose the item: every one on the box when it is shared, else the ones it
// names that still exist.
export async function vaultItemUsage(item: LoadedVaultItem): Promise<string[]> {
    const onDisk = await listAgentIdsOnDisk()
    if (item.config.sharedWithAll) return onDisk.sort()
    return item.config.agentIds.filter(id => onDisk.includes(id))
}

function assertServers(config: Pick<VaultItemConfig, 'mcpServers' | 'skills'>): void {
    for (const server of config.mcpServers) {
        if ([...Object.values(server.headers), ...Object.values(server.env)].includes(VAULT_REDACTED)) throw badRequest('A server cannot be written back with a value the Vault redacted')
        if (server.name === BRIDGE_SERVER_NAME) throw badRequest(`"${BRIDGE_SERVER_NAME}" is reserved for Rerun's own tools`)
        if (!MCP_SERVER_NAME_RE.test(server.name)) throw badRequest(`Invalid MCP server name: ${JSON.stringify(server.name)}`)
    }
    const slugs = config.skills.map(skill => skill.slug)
    if (new Set(slugs).size !== slugs.length) throw badRequest('Two skills of one item cannot share a slug')
}

// A paid app is billed per coworker it is plugged into, so it is never handed to everyone at once.
function assertShareable(config: Pick<VaultItemConfig, 'app' | 'sharedWithAll'>): void {
    if (config.sharedWithAll && config.app) throw badRequest('A paid app is attached coworker by coworker, never to everyone')
}

async function assertAgentsExist(agentIds: string[]): Promise<void> {
    const missing = agentIds.filter(id => !isPathSegment(id) || !agentExists(id))
    if (missing.length > 0) throw notFound(`agent ${missing.join(', ')}`)
}

async function assertNoConflicts(candidate: LoadedVaultItem): Promise<void> {
    const others = (await listVaultItems()).filter(item => item.id !== candidate.id)
    const conflicts = findVaultConflicts(candidate, others, await listAgentIdsOnDisk())
    if (conflicts.length > 0) throw new VaultConflictError(conflicts)
}

async function writeItemConfig(id: string, config: VaultItemConfig): Promise<void> {
    await writeFileAtomic(vaultItemPath(id), `${JSON.stringify(config, null, 4)}\n`, { mode: 0o600 })
}

export async function createVaultItem(input: CreateVaultItemInput, id = newId()): Promise<LoadedVaultItem> {
    if (!isPathSegment(id)) throw badRequest('Invalid vault item id')
    const { env, ...fields } = createVaultItemSchema.parse(input)
    const now = nowIso()
    const config = vaultItemConfigSchema.parse({ ...fields, agentIds: [...new Set(fields.agentIds)], createdAt: now, updatedAt: now })
    assertServers(config)
    assertShareable(config)
    // A refused value must fail before the folder exists, or the Vault would list an item nobody made.
    serializeEnv(env)
    return withVaultLock(async () => {
        if (vaultItemExists(id)) throw badRequest(`A vault item ${id} already exists`)
        await assertAgentsExist(config.agentIds)
        await assertNoConflicts({ id, config, env })
        await mkdir(vaultItemDir(id), { recursive: true, mode: 0o700 })
        // The secrets first and `item.json` last: a folder without it is never listed, so a crash in
        // between leaves nothing half made on screen.
        await writeEnvFile(vaultItemEnvPath(id), env)
        await writeItemConfig(id, config)
        return reload(id)
    })
}

export async function updateVaultItem(id: string, patch: UpdateVaultItemInput): Promise<LoadedVaultItem> {
    const parsed = updateVaultItemSchema.parse(patch)
    return withVaultLock(async () => {
        const current = await getVaultItem(id)
        // `null` clears an optional field; `undefined` leaves it as it is.
        const merged: Record<string, unknown> = { ...current.config }
        for (const [field, value] of Object.entries(parsed)) {
            if (value === undefined) continue
            if (value === null && field !== 'slug') delete merged[field]
            else merged[field] = value
        }
        const config = vaultItemConfigSchema.parse({ ...merged, updatedAt: nowIso() })
        assertServers(config)
        assertShareable(config)
        // A patch that leaves what the item puts on a coworker alone (its status, its label) cannot
        // create a clash, and must go through even next to one: a sign-out has to be recorded.
        if (parsed.mcpServers !== undefined || parsed.skills !== undefined || parsed.sharedWithAll !== undefined) await assertNoConflicts({ id, config, env: current.env })
        await writeItemConfig(id, config)
        return reload(id)
    })
}

export async function updateVaultItemEnv(id: string, input: UpdateVaultItemEnvInput): Promise<LoadedVaultItem> {
    const { set, remove } = updateVaultItemEnvSchema.parse(input)
    return withVaultLock(async () => {
        const current = await getVaultItem(id)
        const env = { ...current.env }
        for (const key of remove) delete env[key]
        Object.assign(env, set)
        serializeEnv(env)
        await assertNoConflicts({ id, config: current.config, env })
        await writeEnvFile(vaultItemEnvPath(id), env)
        await writeItemConfig(id, { ...current.config, updatedAt: nowIso() })
        return reload(id)
    })
}

export async function attachVaultItem(id: string, agentId: string): Promise<LoadedVaultItem> {
    return withVaultLock(async () => {
        const current = await getVaultItem(id)
        await assertAgentsExist([agentId])
        if (current.config.agentIds.includes(agentId)) return current
        const config = { ...current.config, agentIds: [...current.config.agentIds, agentId], updatedAt: nowIso() }
        await assertNoConflicts({ id, config, env: current.env })
        await writeItemConfig(id, config)
        return reload(id)
    })
}

export async function detachVaultItem(id: string, agentId: string): Promise<LoadedVaultItem> {
    return withVaultLock(async () => {
        const current = await getVaultItem(id)
        if (!current.config.agentIds.includes(agentId)) return current
        await writeItemConfig(id, { ...current.config, agentIds: current.config.agentIds.filter(other => other !== agentId), updatedAt: nowIso() })
        return reload(id)
    })
}

export async function deleteVaultItem(id: string): Promise<{ detached: string[] }> {
    return withVaultLock(async () => {
        const current = await getVaultItem(id)
        const detached = await vaultItemUsage(current)
        cache.delete(id)
        await rm(vaultItemDir(id), { recursive: true, force: true })
        return { detached }
    })
}

// A coworker deleted from the box leaves every item it was attached to, so a coworker created later
// under the same id never inherits its accounts.
export async function forgetVaultAgent(agentId: string): Promise<string[]> {
    return withVaultLock(async () => {
        const touched: string[] = []
        for (const item of await listVaultItems()) {
            if (!item.config.agentIds.includes(agentId)) continue
            await writeItemConfig(item.id, { ...item.config, agentIds: item.config.agentIds.filter(other => other !== agentId), updatedAt: nowIso() })
            await reload(item.id)
            touched.push(item.id)
        }
        return touched
    })
}
