import { parseServiceRegistryKey } from '@moldwright/contracts'

import { makeDir, readFileText, writeFileText } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'

const REGISTRY_PATH = '.rerun/services.json'
const REGISTRY_DIR = '.rerun'

function filesBase(engineAgentId: string): string {
    return `/agents/${engineAgentId}/files`
}

export type RegistryEntry = {
    status: 'active' | 'needs_config' | 'needs_auth'
    config: Record<string, string>
    authMethodId?: string
    mcpServers: string[]
    envKeys: string[]
    skills: string[]
    oauth?: { serverName: string; url: string }
    managed?: { provider: string; serverName: string; accountEmail?: string }
    composio?: { toolkit: string; serverName: string; connectedAccountId?: string; accountLabel?: string }
    app?: { appSlug: string; serverName: string; accountLabel?: string }
    instanceId?: string
    label?: string
    installedAt: string
}

export type ServiceRegistry = { services: Record<string, RegistryEntry> }

export function registryFootprint(entry: RegistryEntry): { mcpServers: string[]; envKeys: string[]; skills: string[] } {
    return {
        mcpServers: entry.mcpServers ?? (entry as { toolNames?: string[] }).toolNames ?? [],
        envKeys: entry.envKeys ?? [],
        skills: entry.skills ?? [],
    }
}

export function connectorSkillSlugs(reg: ServiceRegistry): Set<string> {
    return new Set(connectorSkillOwners(reg).keys())
}

export function connectorSkillOwners(reg: ServiceRegistry): Map<string, string> {
    const owners = new Map<string, string>()
    for (const [key, entry] of Object.entries(reg.services)) {
        const { slug: service } = parseServiceRegistryKey(key)
        for (const slug of registryFootprint(entry).skills) owners.set(slug, service)
    }
    return owners
}

export function entriesOfSlug(reg: ServiceRegistry, slug: string): Array<{ key: string; entry: RegistryEntry }> {
    return Object.entries(reg.services)
        .filter(([key]) => parseServiceRegistryKey(key).slug === slug)
        .map(([key, entry]) => ({ key, entry }))
        .sort((a, b) => Number(a.key !== slug) - Number(b.key !== slug) || (a.entry.installedAt ?? '').localeCompare(b.entry.installedAt ?? ''))
}

export function resolveRegistryEntry(reg: ServiceRegistry, slugOrKey: string): { key: string; entry: RegistryEntry } | null {
    const entry = reg.services[slugOrKey]
    return entry ? { key: slugOrKey, entry } : null
}

export function sharedSkillSlugs(reg: ServiceRegistry, key: string): Set<string> {
    const { slug } = parseServiceRegistryKey(key)
    const shared = new Set<string>()
    for (const other of entriesOfSlug(reg, slug)) {
        if (other.key === key) continue
        for (const skill of registryFootprint(other.entry).skills) shared.add(skill)
    }
    return shared
}

const STATUS_RANK: Record<RegistryEntry['status'], number> = { active: 0, needs_auth: 1, needs_config: 2 }

export function primaryStatusOfSlug(reg: ServiceRegistry, slug: string): RegistryEntry['status'] | null {
    const entries = entriesOfSlug(reg, slug)
    if (entries.length === 0) return null
    const base = entries.find(e => e.key === slug)
    if (base) return base.entry.status
    return entries.map(e => e.entry.status).sort((a, b) => (STATUS_RANK[a] ?? 9) - (STATUS_RANK[b] ?? 9))[0]
}

export function connectorMcpServerNames(reg: ServiceRegistry): Set<string> {
    return new Set(
        Object.values(reg.services).flatMap(entry =>
            [...registryFootprint(entry).mcpServers, entry.oauth?.serverName, entry.managed?.serverName, entry.composio?.serverName, entry.app?.serverName].filter(
                (name): name is string => !!name,
            ),
        ),
    )
}

export async function readRegistry(conn: EngineConnection, engineAgentId: string): Promise<ServiceRegistry> {
    try {
        const { content } = await readFileText(conn, filesBase(engineAgentId), REGISTRY_PATH)
        const parsed = JSON.parse(content) as unknown
        if (parsed && typeof parsed === 'object' && 'services' in parsed && (parsed as ServiceRegistry).services) {
            return parsed as ServiceRegistry
        }
        return { services: {} }
    } catch {
        return { services: {} }
    }
}

async function writeRegistry(conn: EngineConnection, engineAgentId: string, reg: ServiceRegistry): Promise<void> {
    await makeDir(conn, filesBase(engineAgentId), REGISTRY_DIR).catch(() => {})
    await writeFileText(conn, filesBase(engineAgentId), REGISTRY_PATH, `${JSON.stringify(reg, null, 2)}\n`)
}

export async function upsertRegistryEntry(conn: EngineConnection, engineAgentId: string, key: string, entry: RegistryEntry): Promise<void> {
    const reg = await readRegistry(conn, engineAgentId)
    reg.services[key] = entry
    await writeRegistry(conn, engineAgentId, reg)
}

export async function removeRegistryEntry(conn: EngineConnection, engineAgentId: string, key: string): Promise<void> {
    const reg = await readRegistry(conn, engineAgentId)
    if (reg.services[key]) {
        delete reg.services[key]
        await writeRegistry(conn, engineAgentId, reg)
    }
}
