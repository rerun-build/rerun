import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpSdkServerConfigWithInstance } from 'ai-sdk-provider-claude-code'
import type { LoadedAgent, McpServer } from '../agents/types.js'
import { acquireMcp, agentMcpSpawn, type PooledMcp } from './mcp-pool.js'
import { modelReadyMcpTool } from './mcp.js'

export type RunMcpServer = McpServer & { relay?: PooledMcp }

export function relayMcpServer(relay: PooledMcp, toolTimeoutMs: number): McpSdkServerConfigWithInstance {
    const server = new SdkMcpServer({ name: relay.name, version: '1.0.0' }, { capabilities: { tools: {} } })
    const tools = relay.tools.map(tool => modelReadyMcpTool(relay.name, tool))
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
    server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        try {
            return await relay.call(request.params.name, request.params.arguments ?? {}, { signal: extra.signal, timeout: toolTimeoutMs })
        } catch (error) {
            return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }
        }
    })
    return { type: 'sdk', name: relay.name, instance: server }
}

export async function withPooledRelays(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>, servers: McpServer[]): Promise<RunMcpServer[]> {
    const spawn = agentMcpSpawn(agent)
    return Promise.all(
        servers.map(async server => {
            const relay = await acquireMcp(agent.id, server, spawn)
            return relay ? { ...server, relay } : server
        })
    )
}
