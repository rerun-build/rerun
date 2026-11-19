import type { McpServerStatus } from '@moldwright/contracts'
import type { McpServer } from '../agents/types.js'
import { isAuthError } from './mcp-auth.js'
import { probeMcp, type McpProbe, type McpSpawn } from './mcp.js'

export const MCP_STATUS_TIMEOUT_MS = 15_000

export function classifyProbe(name: string, probe: McpProbe): McpServerStatus {
    if (probe.ok) return { name, status: 'connected', transport: probe.transport, toolCount: probe.toolNames.length }
    return { name, status: isAuthError(probe.error) ? 'needs_auth' : 'error', transport: probe.transport, toolCount: 0, error: probe.error }
}

export async function probeMcpStatuses(agentId: string, servers: McpServer[], env: Record<string, string>, spawn: McpSpawn): Promise<McpServerStatus[]> {
    return Promise.all(servers.map(async server => classifyProbe(server.name, await probeMcp(agentId, server, env, { spawn, timeoutMs: MCP_STATUS_TIMEOUT_MS }))))
}
