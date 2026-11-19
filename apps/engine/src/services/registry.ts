import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseServiceRegistryKey } from '@moldwright/contracts'
import { workspaceDir } from '../config/paths.js'

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

export async function connectorSkillOwners(id: string): Promise<Map<string, string>> {
    const registry = await readRegistry(id)
    const owners = new Map<string, string>()
    for (const [key, entry] of Object.entries(registry?.services ?? {})) {
        const service = parseServiceRegistryKey(key).slug
        for (const slug of entry?.skills ?? []) if (typeof slug === 'string' && slug) owners.set(slug, service)
    }
    return owners
}

export type ConnectorServerState = { key: string; slug: string; label?: string; status: string; isDefault: boolean }

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
