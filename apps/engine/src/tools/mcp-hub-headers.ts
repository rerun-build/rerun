import type { McpServer } from '../agents/types.js'
import { env } from '../config/env.js'

// Every MCP server Rerun hosts itself lives under this prefix. /api/mcp/account also matches: it
// authenticates with its own bearer and ignores both headers, so it costs two useless headers and
// nothing else — not worth an exception.
const HUB_MCP_PREFIX = '/api/mcp/'
const INJECTED_HEADERS = ['x-rerun-key', 'x-rerun-agent', 'x-rerun-vault-item']

// Matched on parsed URLs, not strings: parsing normalises host casing, default ports and `..`
// segments, so `/api/mcp/../../evil` cannot pass as one of ours. The hub base is a parameter
// rather than a call to env() because env() caches on its first call and a test could not vary it.
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

// The hub identifies its caller with these two headers. They are no longer written into an agent's
// config: an agent that edits its own could otherwise authenticate as any other agent of the same
// Box. The engine rebuilds them at connect time from its own env — hence the comparison against
// env().RERUN_HUB_BASE_URL and never the agent's, which the agent can override to point elsewhere —
// and they overwrite whatever the config carries, header casing included. `Authorization` is left
// alone: on /api/mcp/managed it carries the third party's token, put there by withAuth.
//
// `x-rerun-vault-item` names the Vault item a server came from, for the hub to find the account
// behind it (the Composio user an item was connected under). Set here only, from the run's own
// list, so a server a coworker wrote into its config can never borrow another item's account.
export function withHubHeaders(server: McpServer, agentId: string, vaultItemId?: string): McpServer {
    const { RERUN_HUB_BASE_URL, RERUN_API_KEY } = env()
    if (!isHubMcpUrl(server.url, RERUN_HUB_BASE_URL)) return server
    const carried = Object.entries(server.headers).filter(([key]) => !INJECTED_HEADERS.includes(key.toLowerCase()))
    const vault: Record<string, string> = vaultItemId ? { 'x-rerun-vault-item': vaultItemId } : {}
    return { ...server, headers: { ...Object.fromEntries(carried), 'x-rerun-key': RERUN_API_KEY ?? '', 'x-rerun-agent': agentId, ...vault } }
}
