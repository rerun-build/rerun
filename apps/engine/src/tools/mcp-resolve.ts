import { MCP_PLACEHOLDER } from '@rerun/contracts'
import type { McpServer } from '../agents/types.js'
import { logger } from '../lib/logger.js'

// Only the agent's own env answers a placeholder. The engine's process env holds RERUN_API_KEY, and
// a server config travels inside template archives: `${RERUN_API_KEY}` in a header pointed at the
// author's domain would hand them the key of every box that installs the template. The hub base
// URL is the one engine value a catalog entry references, and it is public; the hub key itself is
// put back on hub servers by withHubHeaders, from the engine env, never from the config.
const ENGINE_ENV_PLACEHOLDERS = new Set(['RERUN_HUB_BASE_URL'])

function resolveValue(value: string, env: Record<string, string>, serverName: string): string {
    return value.replace(MCP_PLACEHOLDER, (whole, file: string | undefined, name: string) => {
        if (file) return whole
        const resolved = env[name] ?? (ENGINE_ENV_PLACEHOLDERS.has(name) ? process.env[name] : undefined)
        if (resolved === undefined) {
            logger.warn({ server: serverName, var: name }, 'mcp: unresolved placeholder')
            return ''
        }
        return resolved
    })
}

function resolveRecord(rec: Record<string, string>, env: Record<string, string>, serverName: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(rec)) out[k] = resolveValue(v, env, serverName)
    return out
}

export function resolveServerSecrets(server: McpServer, env: Record<string, string>): McpServer {
    return {
        ...server,
        command: server.command ? resolveValue(server.command, env, server.name) : server.command,
        args: server.args.map(a => resolveValue(a, env, server.name)),
        url: server.url ? resolveValue(server.url, env, server.name) : server.url,
        env: resolveRecord(server.env, env, server.name),
        headers: resolveRecord(server.headers, env, server.name),
    }
}
