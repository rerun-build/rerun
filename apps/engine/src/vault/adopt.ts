import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { FOREMAN_AGENT_ID, parseServiceRegistryKey, type CreateVaultItemInput, type McpServer } from '@rerun/contracts'
import { agentEnvPath, mcpTokenPath, workspaceDir } from '../config/paths.js'
import { readEnvFile } from '../lib/env-file.js'
import { logger } from '../lib/logger.js'
import { listAgentIdsOnDisk, readAgentConfig } from '../agents/loader.js'
import { readSkill } from '../skills/loader.js'
import { REGISTRY_WORKSPACE_PATH } from '../services/registry.js'
import type { StoredToken } from '../tools/mcp-auth.js'
import { attachVaultItem, createVaultItem, listVaultItems, updateVaultItem } from './store.js'
import { readAdopted, writeAdopted, type Adopted } from './adopted.js'
import { loadVaultToken, saveVaultToken } from './tokens.js'
import type { LoadedVaultItem } from './types.js'

// Moving a box onto the Vault: every catalog app a coworker installed in its own folder becomes an
// item of the Vault attached to that coworker alone. Nothing is taken out of the coworker's folder,
// so an engine from before the Vault, put back in place, still finds every account where it left
// it; the item wins over that copy at run time, and the copy goes in a later step.
//
// Two coworkers share an item only when that is certain: the same app keyed with the same values
// and the same servers. An account signed in through OAuth is never merged, since two sign-ins of
// one account are two token lineages. A merge made wrongly could disconnect someone; a duplicate
// never breaks anything.
//
// Left in the coworker's folder for now: a paid app (its account lives in Supabase), a Composio
// account (its id depends on the hub's id of the coworker), and the coworker's custom servers
// (`mcp_register` writes their keys into its `.env`, where a copy in the Vault would go stale).

const registryEntrySchema = z
    .object({
        status: z.enum(['active', 'needs_config', 'needs_auth']).catch('active'),
        config: z.record(z.string(), z.string()).catch({}),
        authMethodId: z.string().optional(),
        mcpServers: z.array(z.string()).catch([]),
        envKeys: z.array(z.string()).catch([]),
        skills: z.array(z.string()).catch([]),
        oauth: z.object({ serverName: z.string(), url: z.string() }).optional().catch(undefined),
        managed: z.object({ provider: z.string(), serverName: z.string(), accountEmail: z.string().optional() }).optional().catch(undefined),
        composio: z.object({ toolkit: z.string() }).passthrough().optional().catch(undefined),
        app: z.object({ appSlug: z.string() }).passthrough().optional().catch(undefined),
        instanceId: z.string().optional(),
        label: z.string().optional(),
        installedAt: z.string().optional(),
    })
    .passthrough()
export type OwnRegistryEntry = z.infer<typeof registryEntrySchema>

export async function readOwnRegistryEntries(agentId: string): Promise<Record<string, OwnRegistryEntry>> {
    const path = resolve(workspaceDir(agentId), REGISTRY_WORKSPACE_PATH)
    if (!existsSync(path)) return {}
    try {
        const raw = JSON.parse(await readFile(path, 'utf8')) as { services?: Record<string, unknown> }
        const entries: Record<string, OwnRegistryEntry> = {}
        for (const [key, value] of Object.entries(raw.services ?? {})) {
            const parsed = registryEntrySchema.safeParse(value)
            if (parsed.success) entries[key] = parsed.data
        }
        return entries
    } catch {
        return {}
    }
}

// What stays in the coworker's folder, and why: the doctor reports the rest as waiting.
export function adoptionSkipReason(entry: OwnRegistryEntry): string | null {
    if (entry.app) return 'paid app'
    if (entry.composio) return 'Composio account'
    return null
}

// The compiler writes the coworker's own id into its servers (the hub identity headers); an item
// names whoever calls it instead.
function withoutAgentId(server: McpServer, agentId: string): McpServer {
    const swap = (value: string) => value.replaceAll(agentId, '${RERUN_AGENT_ID}')
    const swapRecord = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, swap(value)]))
    return {
        ...server,
        ...(server.url === undefined ? {} : { url: swap(server.url) }),
        ...(server.command === undefined ? {} : { command: swap(server.command) }),
        args: server.args.map(swap),
        env: swapRecord(server.env),
        headers: swapRecord(server.headers),
    }
}

type Candidate = { key: string; entry: OwnRegistryEntry; input: CreateVaultItemInput; tokens: Record<string, StoredToken> }

async function candidateOf(agentId: string, agentName: string, key: string, entry: OwnRegistryEntry, servers: McpServer[], env: Record<string, string>): Promise<Candidate | null> {
    const { slug, instanceId } = parseServiceRegistryKey(key)
    const own = new Map(servers.map(server => [server.name, server]))
    const missing = entry.mcpServers.filter(name => !own.has(name))
    if (missing.length > 0) {
        logger.warn({ agent: agentId, key, missing }, 'vault adoption: connector left in the coworker folder, its servers are gone from its config')
        return null
    }
    const skills = []
    for (const skillSlug of entry.skills) {
        const skill = await readSkill(agentId, skillSlug).catch(() => null)
        if (skill?.body) skills.push({ slug: skillSlug, name: skill.name, description: skill.description, body: skill.body })
    }
    const tokens: Record<string, StoredToken> = {}
    for (const server of entry.mcpServers) {
        const path = mcpTokenPath(agentId, server)
        if (!existsSync(path)) continue
        try {
            tokens[server] = JSON.parse(await readFile(path, 'utf8')) as StoredToken
        } catch {
            // An unreadable token is a sign-in to make again, as it already was for the coworker.
        }
    }
    const input: CreateVaultItemInput = {
        kind: 'service',
        slug,
        name: slug,
        label: entry.label ?? agentName,
        status: entry.status,
        ...(entry.authMethodId ? { authMethodId: entry.authMethodId } : {}),
        config: entry.config,
        mcpServers: entry.mcpServers.map(name => withoutAgentId(own.get(name) as McpServer, agentId)),
        skills,
        ...(entry.oauth ? { oauth: entry.oauth } : {}),
        ...(entry.managed ? { managed: entry.managed } : {}),
        ...(instanceId ?? entry.instanceId ? { instanceId: instanceId ?? entry.instanceId } : {}),
        env: Object.fromEntries(entry.envKeys.flatMap(name => (env[name] ? [[name, env[name]]] : []))),
        agentIds: [agentId],
        createdBy: null,
    }
    return { key, entry, input, tokens }
}

// Only an app keyed with values, nothing signed in, can be told the same as another one for sure.
function mergeKey(input: Pick<CreateVaultItemInput, 'slug' | 'instanceId' | 'authMethodId' | 'config' | 'mcpServers' | 'env' | 'oauth' | 'managed'>): string | null {
    const env = input.env ?? {}
    if (input.oauth || input.managed || Object.keys(env).length === 0) return null
    const sorted = (record: Record<string, string> = {}) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
    return JSON.stringify([input.slug, input.instanceId ?? null, input.authMethodId ?? null, sorted(input.config), input.mcpServers ?? [], sorted(env)])
}

function itemMergeKey(item: LoadedVaultItem): string | null {
    if (item.config.kind !== 'service' || item.config.createdBy !== null || item.config.sharedWithAll) return null
    return mergeKey({ ...item.config, env: item.env, slug: item.config.slug ?? undefined })
}

export function heldAlready(items: LoadedVaultItem[], agentId: string, key: string): boolean {
    const { slug, instanceId } = parseServiceRegistryKey(key)
    return items.some(item => item.config.kind === 'service' && item.config.slug === slug && (item.config.instanceId ?? undefined) === instanceId && (item.config.sharedWithAll || item.config.agentIds.includes(agentId)))
}

async function adoptAgent(agentId: string, adopted: Adopted): Promise<number> {
    const config = await readAgentConfig(agentId).catch(() => null)
    if (!config || config.kind === 'foreman' || config.ephemeral || agentId === FOREMAN_AGENT_ID) return 0
    const entries = await readOwnRegistryEntries(agentId)
    if (Object.keys(entries).length === 0) return 0
    const env = await readEnvFile(agentEnvPath(agentId)).catch(() => ({}) as Record<string, string>)
    const done = (adopted.agents[agentId] ??= {})
    let count = 0

    for (const [key, entry] of Object.entries(entries)) {
        if (adoptionSkipReason(entry)) continue
        const previous = done[key]
        if (previous && previous.installedAt === (entry.installedAt ?? null)) continue
        const items = await listVaultItems()
        if (heldAlready(items, agentId, key)) continue
        const candidate = await candidateOf(agentId, config.displayName || config.name, key, entry, config.mcpServers, env)
        if (!candidate) continue
        try {
            const wanted = mergeKey(candidate.input)
            const twin = wanted ? items.find(item => itemMergeKey(item) === wanted) : undefined
            // A twin named after the first coworker it came from is no longer that coworker's alone.
            if (twin && twin.config.label !== candidate.input.label) await updateVaultItem(twin.id, { label: null })
            const item = twin ? await attachVaultItem(twin.id, agentId) : await createVaultItem(candidate.input)
            for (const [server, token] of Object.entries(candidate.tokens)) await saveVaultToken(item.id, server, token)
            done[key] = { itemId: item.id, installedAt: entry.installedAt ?? null }
            count += 1
        } catch (err) {
            logger.warn({ agent: agentId, key, err: String(err) }, 'vault adoption: connector left in the coworker folder')
        }
    }
    return count
}

// Re-runnable: what was adopted is skipped, and a box adopts on every boot what an older hub, an
// imported coworker or an engine put back in place wrote in a coworker's folder since.
export async function adoptConnectors(): Promise<number> {
    return withAdoptionLock(async () => {
        const adopted = readAdopted()
        let count = 0
        for (const agentId of await listAgentIdsOnDisk()) count += await adoptAgent(agentId, adopted)
        if (count === 0) return 0
        await writeAdopted(adopted)
        logger.info({ count }, 'vault adoption: connectors moved to the Vault')
        return count
    })
}

// Not the Vault's own lock: creating and attaching items take it themselves.
const adoptionChain: { current: Promise<unknown> } = { current: Promise.resolve() }
function withAdoptionLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = adoptionChain.current.then(fn, fn)
    adoptionChain.current = next.catch(() => {})
    return next
}

// On boot: a copy refreshed more recently than the Vault's token, by an engine from before the Vault
// that ran in between, is the live one. A token the Vault no longer holds (signed out) stays gone.
export async function takeNewerAdoptedTokens(): Promise<void> {
    const items = new Map((await listVaultItems()).map(item => [item.id, item]))
    for (const [agentId, keys] of Object.entries(readAdopted().agents)) {
        for (const { itemId } of Object.values(keys)) {
            const item = items.get(itemId)
            if (!item) continue
            for (const server of item.config.mcpServers.map(s => s.name)) {
                const path = mcpTokenPath(agentId, server)
                if (!existsSync(path)) continue
                const current = await loadVaultToken(itemId, server)
                if (!current) continue
                const copy = await readFile(path, 'utf8').then(text => JSON.parse(text) as StoredToken).catch(() => null)
                if (copy && copy.obtainedAt > current.obtainedAt) await saveVaultToken(itemId, server, copy)
            }
        }
    }
}
