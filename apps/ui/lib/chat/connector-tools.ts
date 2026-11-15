import { stripBridgePrefix } from '@/lib/chat/bridge-name'
import type { CustomMcpServer, InstalledService } from '@/lib/services/types'

export type ConnectorService = { slug: string; name: string; label?: string; icon: string | null; category: string; custom?: true }

export type ConnectorMap = ReadonlyMap<string, ConnectorService>

const MCP_PREFIX = 'mcp__'
const SEPARATOR = '__'
const NATIVE_SEPARATOR = '_'

function serverNamesOf(service: InstalledService): string[] {
    return [...(service.toolNames ?? []), service.oauth?.serverName, service.managed?.serverName, service.composio?.serverName].filter(
        (name): name is string => !!name,
    )
}

export function buildConnectorMap(services: InstalledService[], custom: CustomMcpServer[] = []): ConnectorMap {
    const map = new Map<string, ConnectorService>()
    for (const service of services) {
        for (const name of serverNamesOf(service)) {
            if (!map.has(name)) map.set(name, { slug: service.slug, name: service.name, ...(service.label ? { label: service.label } : {}), icon: service.icon, category: service.category })
        }
    }
    for (const server of custom) {
        if (!map.has(server.name)) map.set(server.name, { slug: `mcp:${server.name}`, name: server.displayName, icon: server.icon, category: 'custom', custom: true })
    }
    return map
}

function splitOnKnownServer(name: string, knownServers: Iterable<string>, separator: string): { server: string; tool: string } | null {
    let best: { server: string; tool: string } | null = null
    for (const server of knownServers) {
        if (!name.startsWith(server + separator)) continue
        if (best && best.server.length >= server.length) continue
        best = { server, tool: name.slice(server.length + separator.length) }
    }
    return best
}

export function parseMcpToolName(raw: string, knownServers: Iterable<string>, isBuiltin: (name: string) => boolean = () => false): { server: string; tool: string } | null {
    if (stripBridgePrefix(raw) !== raw) return null
    const servers = [...knownServers]
    if (raw.startsWith(MCP_PREFIX)) return splitOnKnownServer(raw.slice(MCP_PREFIX.length), servers, SEPARATOR)
    if (isBuiltin(raw)) return null
    return splitOnKnownServer(raw, servers, SEPARATOR) ?? splitOnKnownServer(raw, servers, NATIVE_SEPARATOR)
}

export function humanizeToolSegment(segment: string): string {
    return segment
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase())
}

export function resolveConnectorTool(raw: string, map: ConnectorMap, isBuiltin?: (name: string) => boolean): { label: string; service: ConnectorService } | null {
    const parsed = parseMcpToolName(raw, map.keys(), isBuiltin)
    if (!parsed) return null
    const service = map.get(parsed.server)
    if (!service) return null
    const tool = humanizeToolSegment(parsed.tool)
    return { label: service.custom ? `${service.name} · ${tool}` : tool, service }
}
