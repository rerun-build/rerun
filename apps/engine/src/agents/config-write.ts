import { configPath } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'
import { BRIDGE_SERVER_NAME, MCP_SERVER_NAME_RE, type AgentConfig, type McpServer } from './types.js'

export async function writeAgentConfig(id: string, config: AgentConfig): Promise<void> {
    await writeFileAtomic(configPath(id), JSON.stringify(config, null, 4), { mode: 0o600 })
}

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
