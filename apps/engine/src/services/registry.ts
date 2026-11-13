import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseServiceRegistryKey } from '@rerun/contracts'
import { workspaceDir } from '../config/paths.js'
import { vaultItemsForAgent } from '../vault/store.js'

// The per-agent "installed connectors" registry is written by the UI into the agent's own
// workspace, so it travels with the agent. The engine only reads it: it is the sole record of
// which skills, mcp servers and env keys a connector install put in the agent folder. Keyed by
// `serviceRegistryKey`: the bare catalog slug for the first account of an app, `<slug>@<id>` for
// every other one.
export type RegistryEntry = {
    status?: string
    label?: string
    instanceId?: string
    mcpServers?: string[]
    envKeys?: string[]
    skills?: string[]
    oauth?: { serverName?: string }
    managed?: { serverName?: string; accountEmail?: string }
    composio?: { serverName?: string; accountLabel?: string }
    app?: { serverName?: string }
}

export type ServiceRegistry = { services?: Record<string, RegistryEntry> }

export const REGISTRY_WORKSPACE_PATH = '.rerun/services.json'

export async function readRegistry(id: string): Promise<ServiceRegistry | null> {
    const path = resolve(workspaceDir(id), REGISTRY_WORKSPACE_PATH)
    if (!existsSync(path)) return null
    try {
        return JSON.parse(await readFile(path, 'utf8')) as ServiceRegistry
    } catch {
        return null
    }
}

// Skill slug → slug of the connector that installed it, whether the coworker installed it itself
// or a Vault item attached to it wrote it. An agent with no connector has no registry at all, so
// absent, unreadable and footprint-less all answer the same empty map.
export async function connectorSkillOwners(id: string): Promise<Map<string, string>> {
    const registry = await readRegistry(id)
    const owners = new Map<string, string>()
    for (const [key, entry] of Object.entries(registry?.services ?? {})) {
        const service = parseServiceRegistryKey(key).slug
        for (const slug of entry?.skills ?? []) if (typeof slug === 'string' && slug) owners.set(slug, service)
    }
    for (const item of vaultItemsForAgent(id)) for (const skill of item.config.skills) owners.set(skill.slug, item.config.slug ?? item.config.name)
    return owners
}

// `slug` names the catalog app, `key` the registry entry. `isDefault` marks the account installed
// under the bare slug, the one an app with several accounts falls back to.
export type ConnectorServerState = { key: string; slug: string; label?: string; status: string; isDefault: boolean }

// MCP server name → the connector that installed it and where its setup stands. A connector can
// put its server on the agent before the user connects the account behind it, so a server that
// loads and lists tools may still answer every call with "not connected": only this status says so.
export async function connectorServerStates(id: string): Promise<Map<string, ConnectorServerState>> {
    const registry = await readRegistry(id)
    const states = new Map<string, ConnectorServerState>()
    for (const [key, entry] of Object.entries(registry?.services ?? {})) {
        if (!entry) continue
        const { slug, instanceId } = parseServiceRegistryKey(key)
        const label = typeof entry.label === 'string' && entry.label ? entry.label : undefined
        const state: ConnectorServerState = { key, slug, ...(label ? { label } : {}), status: entry.status ?? 'active', isDefault: !instanceId }
        const footprint = entry.mcpServers ?? (entry as { toolNames?: string[] }).toolNames ?? []
        const authTargets = [entry.oauth?.serverName, entry.managed?.serverName, entry.composio?.serverName, entry.app?.serverName]
        for (const name of [...footprint, ...authTargets]) {
            if (typeof name === 'string' && name) states.set(name, state)
        }
    }
    return states
}
