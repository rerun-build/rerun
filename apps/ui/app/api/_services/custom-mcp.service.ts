import type { Actor } from '@/app/api/_auth/access'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { installedFromRegistry } from '@/app/api/_services/services.service'
import { deleteMcpToken, getAgent, getMcpServerStatuses, getMcpSessionStates as fetchMcpSessionStates, patchMcpServers, reconnectMcpServer } from '@/lib/engine/client'
import type { EngineConnection, EngineMcpServer } from '@/lib/engine/types'
import { brandLabel, mcpIconDomain, mcpServerHost, toCustomMcpServer, unclaimedMcpServers } from '@/lib/services/custom-mcp'
import { verifiedFaviconUrl } from '@/lib/services/mcp-favicon.server'
import { connectorMcpServerNames, readRegistry, type ServiceRegistry } from '@/lib/services/registry'
import type { CustomMcpLiveStatus, CustomMcpServer, CustomMcpStatus, InstalledService } from '@/lib/services/types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'

type CatalogLook = { name: string; icon: string }

async function catalogLooks(servers: EngineMcpServer[]): Promise<Map<string, CatalogLook>> {
    const candidates = new Set<string>()
    for (const server of servers) {
        const domain = mcpIconDomain(mcpServerHost(server.url))
        if (domain) candidates.add(brandLabel(domain))
        candidates.add(server.name.toLowerCase())
    }
    if (candidates.size === 0) return new Map()
    const { data } = await selectMany(createServiceRoleClient(), 'services', ['slug', 'name', 'icon'] as const, { slug: { in: [...candidates] } })
    return new Map((data ?? []).filter((row): row is typeof row & { icon: string } => !!row.icon).map(row => [row.slug, { name: row.name, icon: row.icon }]))
}

async function lookOf(server: EngineMcpServer, catalog: Map<string, CatalogLook>): Promise<{ displayName?: string; icon: string | null }> {
    const domain = mcpIconDomain(mcpServerHost(server.url))
    const match = (domain && catalog.get(brandLabel(domain))) || catalog.get(server.name.toLowerCase())
    if (match) return { displayName: match.name, icon: match.icon }
    return { icon: domain ? await verifiedFaviconUrl(domain) : null }
}

export async function customMcpServersOf(conn: EngineConnection, engineAgentId: string, reg: ServiceRegistry): Promise<CustomMcpServer[]> {
    const detail = await getAgent(conn, engineAgentId)
    const servers = unclaimedMcpServers(detail.config.mcpServers ?? [], reg)
    if (servers.length === 0) return []
    const catalog = await catalogLooks(servers)
    return Promise.all(servers.map(async server => toCustomMcpServer(server, await lookOf(server, catalog))))
}

export async function listAgentConnectors(agentId: string, actor?: Actor): Promise<{ services: InstalledService[]; custom: CustomMcpServer[] }> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor)
    const reg = await readRegistry(conn, engineAgentId)
    const [services, custom] = await Promise.all([installedFromRegistry(reg), customMcpServersOf(conn, engineAgentId, reg).catch(() => [])])
    return { services, custom }
}

export async function getCustomMcpStatuses(agentId: string, actor?: Actor): Promise<CustomMcpStatus[]> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor)
    const detail = await getAgent(conn, engineAgentId)
    const names = unclaimedMcpServers(detail.config.mcpServers ?? [], await readRegistry(conn, engineAgentId)).map(server => server.name)
    if (names.length === 0) return []
    const statuses = await getMcpServerStatuses(conn, engineAgentId, names)
    if (!statuses) return names.map(name => ({ name, status: 'unknown', toolCount: 0 }))
    return statuses.map(({ name, status, toolCount, error }) => ({ name, status, toolCount, ...(error ? { error } : {}) }))
}

export async function getMcpSessionStates(agentId: string, actor?: Actor): Promise<{ name: string; state: string; errorClass?: string }[]> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor)
    const states = await fetchMcpSessionStates(conn, engineAgentId)
    if (!states) return []
    return states.map(({ name, state, errorClass }) => ({ name, state, ...(errorClass ? { errorClass } : {}) }))
}

export async function reconnectMcpSession(agentId: string, name: string, actor?: Actor): Promise<{ name: string; reconnected: boolean; effect: string; announced: number }> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'use')
    const result = await reconnectMcpServer(conn, engineAgentId, name)
    return { name: result.name, reconnected: result.reconnected, effect: result.effect, announced: result.announced }
}

export async function getCustomMcpServer(agentId: string, name: string, actor?: Actor): Promise<{ server: CustomMcpServer; status: CustomMcpLiveStatus } | null> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor)
    const server = (await customMcpServersOf(conn, engineAgentId, await readRegistry(conn, engineAgentId))).find(candidate => candidate.name === name)
    if (!server) return null
    const statuses = await getMcpServerStatuses(conn, engineAgentId, [name]).catch(() => null)
    return { server, status: statuses?.find(entry => entry.name === name)?.status ?? 'unknown' }
}

export async function removeCustomMcpServer(agentId: string, name: string, actor?: Actor): Promise<void> {
    const { conn, engineAgentId } = await resolveAgentTarget(agentId, actor, 'manage')
    if (connectorMcpServerNames(await readRegistry(conn, engineAgentId)).has(name)) {
        throw new Error(`"${name}" belongs to an app. Manage it from the Apps tab.`)
    }
    await patchMcpServers(conn, engineAgentId, { remove: [name] })
    await deleteMcpToken(conn, engineAgentId, name).catch(() => {})
}
