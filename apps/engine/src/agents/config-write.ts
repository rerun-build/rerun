import { configPath } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { BRIDGE_SERVER_NAME, MCP_SERVER_NAME_RE, type AgentConfig, type McpServer } from './types.js'

// Atomic so a concurrent reader (loadAgentFromDisk, GET /:id, mcp_status) never observes a
// half-written file. 0600: the config carries MCP server headers and env, which are secrets.
export async function writeAgentConfig(id: string, config: AgentConfig): Promise<void> {
    await writeFileAtomic(configPath(id), JSON.stringify(config, null, 4), { mode: 0o600 })
}

// Refused here rather than at the provider, which can only drop the server and has nobody left to
// report it to: a run would start with the config showing the server and the model holding none of
// its tools, and the model has no way to tell that from a server that is simply down.
export class ReservedMcpServerNameError extends Error {
    constructor() {
        super(`"${BRIDGE_SERVER_NAME}" is reserved for the engine's own tools. Register this server under another name, for example "${BRIDGE_SERVER_NAME}_admin".`)
    }
}

export class InvalidMcpServerNameError extends Error {
    constructor(name: string) {
        super(`MCP server name "${name}" is invalid: use 1-64 characters (letters, digits, underscores, hyphens). Tools are exposed as "<server>_<tool>" and providers reject other characters.`)
    }
}

// Only `upsert` is validated: a config already holding an invalid legacy name must stay loadable
// and removable.
export function mergeMcpServers(current: McpServer[], patch: { upsert?: McpServer[]; remove?: string[] }): McpServer[] {
    const removed = new Set(patch.remove ?? [])
    const byName = new Map(current.filter(s => !removed.has(s.name)).map(s => [s.name, s]))
    for (const s of patch.upsert ?? []) {
        if (s.name === BRIDGE_SERVER_NAME) throw new ReservedMcpServerNameError()
        if (!MCP_SERVER_NAME_RE.test(s.name)) throw new InvalidMcpServerNameError(s.name)
        byName.set(s.name, s)
    }
    return [...byName.values()]
}
