import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpSdkServerConfigWithInstance } from 'ai-sdk-provider-claude-code'
import type { LoadedAgent, McpServer } from '../agents/types.js'
import { acquireMcp, agentMcpSpawn, type PooledMcp } from './mcp-pool.js'
import { mcpToolNameFor, modelReadyMcpTool, type McpCallResult, type McpTool } from './mcp.js'
import { capToolResult, TOOL_RESULT_CHAR_LIMIT } from './builtin/tool-result-file.js'

// A server the engine already holds a connection to, as the run hands it to a provider: the CLI is
// given the relay in its place, the stored entry stays for the providers that dial it themselves.
export type RunMcpServer = McpServer & { relay?: PooledMcp }

// An in-process server under the original name, so the CLI still sees `mcp__<server>__<tool>` and
// nothing downstream (allowed tools, hooks, the chat) can tell. Every call is passed on to the pooled
// connection as the model made it. The listed schemas go through `modelReadyMcpTool`: the CLI never
// hands the model a tool whose schema has a root `anyOf`, so the mail server's send_email,
// reply_to_email and continue_email_thread answered "No such tool available".
export function relayMcpServer(relay: PooledMcp, callOptions: RequestOptions): McpSdkServerConfigWithInstance {
    const server = new SdkMcpServer({ name: relay.name, version: '1.0.0' }, { capabilities: { tools: {} } })
    const tools = relay.tools.map(tool => withoutOutputSchema(modelReadyMcpTool(relay.name, tool)))
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
    server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        try {
            const result = await relay.call(request.params.name, request.params.arguments ?? {}, { ...callOptions, signal: extra.signal })
            return await capRelayedResult(relay.agentId, mcpToolNameFor('claude', relay.name, request.params.name), result)
        } catch (error) {
            return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }
        }
    })
    return { type: 'sdk', name: relay.name, instance: server }
}

// A cut result goes out without its structured part, which would carry the whole of it again, so
// the CLI is never told of an output schema it would then hold the result to.
function withoutOutputSchema(tool: McpTool): McpTool {
    const { outputSchema: _outputSchema, ...listed } = tool
    return listed
}

type ContentPart = { type: string; text?: string }

// The same limit as every other tool result: the text the model would read is cut and saved whole,
// an image it sees as an image stays.
async function capRelayedResult(agentId: string, toolName: string, result: McpCallResult): Promise<McpCallResult> {
    if (!('content' in result) || !Array.isArray(result.content)) return result
    const content = result.content as ContentPart[]
    const texts = content.filter(part => part.type === 'text').map(part => part.text ?? '')
    const text = texts.length > 0 ? texts.join('\n') : (JSON.stringify(result.structuredContent ?? '') ?? '')
    if (text.length <= TOOL_RESULT_CHAR_LIMIT) return result
    const { structuredContent: _structuredContent, ...rest } = result
    return { ...rest, content: [{ type: 'text', text: await capToolResult(agentId, toolName, text) }, ...content.filter(part => part.type !== 'text')] } as McpCallResult
}

// Each server the pool can hold carries its relay; one it cannot reach stays as declared, and the CLI
// dials it itself as it always did.
export async function withPooledRelays(agent: Pick<LoadedAgent, 'id' | 'env' | 'config' | 'hubAgentId'>, servers: McpServer[]): Promise<RunMcpServer[]> {
    const spawn = agentMcpSpawn(agent)
    return Promise.all(
        servers.map(async server => {
            const relay = await acquireMcp(agent.id, server, spawn)
            return relay ? { ...server, relay } : server
        })
    )
}
