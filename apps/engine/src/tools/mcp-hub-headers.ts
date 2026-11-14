import type { McpServer } from '../agents/types.js'
import { env } from '../config/env.js'

const HUB_MCP_PREFIX = '/api/mcp/'
const INJECTED_HEADERS = ['x-rerun-key', 'x-rerun-agent']

export function isHubMcpUrl(url: string | undefined, hubBaseUrl: string | undefined): boolean {
    if (!url || !hubBaseUrl) return false
    try {
        const target = new URL(url)
        const hub = new URL(hubBaseUrl)
        return target.origin === hub.origin && target.pathname.startsWith(`${hub.pathname.replace(/\/+$/, '')}${HUB_MCP_PREFIX}`)
    } catch {
        return false
    }
}

export function withHubHeaders(server: McpServer, agentId: string): McpServer {
    const { RERUN_HUB_BASE_URL, RERUN_API_KEY } = env()
    if (!isHubMcpUrl(server.url, RERUN_HUB_BASE_URL)) return server
    const carried = Object.entries(server.headers).filter(([key]) => !INJECTED_HEADERS.includes(key.toLowerCase()))
    return { ...server, headers: { ...Object.fromEntries(carried), 'x-rerun-key': RERUN_API_KEY ?? '', 'x-rerun-agent': agentId } }
}
