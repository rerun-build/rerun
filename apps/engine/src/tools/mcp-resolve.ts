import type { McpServer } from '../agents/types.js'
import { logger } from '../lib/logger.js'

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

const ENGINE_ENV_PLACEHOLDERS = new Set(['RERUN_HUB_BASE_URL'])

function resolveValue(value: string, env: Record<string, string>, serverName: string): string {
    return value.replace(PLACEHOLDER, (_, name: string) => {
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
