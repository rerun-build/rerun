import { argsOf } from '@rerun/contracts'
import { APP_RUN_TOOL } from '@/lib/apps/catalog'
import { stripBridgePrefix } from '@/lib/chat/bridge-name'
import type { CustomMcpServer, InstalledService } from '@/lib/services/types'

// `custom`: a server registered outside the catalog, whose tools keep its name in their label.
// `label` tells two accounts of one app apart (an email, or "Gmail 2").
export type ConnectorService = { slug: string; name: string; label?: string; icon: string | null; category: string; custom?: true }

export type ConnectorMap = ReadonlyMap<string, ConnectorService>

const MCP_PREFIX = 'mcp__'
const SEPARATOR = '__'
// The engine's own providers name a tool <server>_<tool>, the CLI providers <server>__<tool>.
const NATIVE_SEPARATOR = '_'

// A connector can expose several mcp servers, and its auth target names a server the footprint
// does not always list. Same flatten as AgentPanelMcp.
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

// A server name may itself contain `__` (MCP_SERVER_NAME_RE allows it), so splitting on the first
// separator can cut in the wrong place: only the installed server names decide where the cut is,
// longest match first.
function splitOnKnownServer(name: string, knownServers: Iterable<string>, separator: string): { server: string; tool: string } | null {
    let best: { server: string; tool: string } | null = null
    for (const server of knownServers) {
        if (!name.startsWith(server + separator)) continue
        if (best && best.server.length >= server.length) continue
        best = { server, tool: name.slice(server.length + separator.length) }
    }
    return best
}

// Codex only prefixes `mcp__` when `prefix_mcp_tool_names` is on, so an older session can hold the
// bare `<server>__<tool>` form; both are accepted, and so is the engine's own `<server>_<tool>`. A
// bridged builtin is never a connector tool, nor is a builtin whose name happens to start like a
// server (`memory_write` beside a server named `memory`).
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

// A paid app runs the tools of its directory through one call: the step is named after the tool
// that ran, not after the call.
function ranTool(tool: string, input: unknown): string {
    const ran = tool === APP_RUN_TOOL ? argsOf(input)?.tool : undefined
    return typeof ran === 'string' && ran ? ran : tool
}

// Null means "not a connector tool": the caller falls back to getToolMeta, so anything unmapped
// keeps today's rendering untouched.
export function resolveConnectorTool(raw: string, map: ConnectorMap, isBuiltin?: (name: string) => boolean, input?: unknown): { label: string; service: ConnectorService } | null {
    const parsed = parseMcpToolName(raw, map.keys(), isBuiltin)
    if (!parsed) return null
    const service = map.get(parsed.server)
    if (!service) return null
    const ran = ranTool(parsed.tool, input)
    const tool = humanizeToolSegment(ran.startsWith(`${parsed.server}_`) ? ran.slice(parsed.server.length + 1) : ran)
    return { label: service.custom ? `${service.name} · ${tool}` : tool, service }
}
