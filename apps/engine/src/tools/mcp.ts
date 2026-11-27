import { dynamicTool, jsonSchema, type ToolSet } from 'ai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Provider } from '@rerun/contracts'
import { CLI_PROVIDERS, type LoadedAgent, type McpServer } from '../agents/types.js'
import { agentMcpCredentialsDir, vaultMcpCredentialsDir, workspaceDir } from '../config/paths.js'
import { withAuth } from './mcp-auth.js'
import { withHubHeaders } from './mcp-hub-headers.js'
import { withInstalledPackage } from './mcp-packages.js'
import { fileVariables, materializeFileSecrets } from './mcp-file-secrets.js'
import { resolveServerSecrets } from './mcp-resolve.js'
import { findVaultItem } from '../vault/store.js'
import type { AgentMcpServer } from '../vault/runtime.js'
import { toToolInputSchema } from './mcp-schema.js'
import { logger } from '../lib/logger.js'

// What a stdio server started for an agent runs in: the bare essentials of the engine's own
// environment, the agent's keys, and its workspace as the working directory. Never the engine's
// `process.env`, which holds its API key: a probe asked for by the agent itself spawns the command too.
export type McpSpawn = { cwd: string; env: Record<string, string> }
export type McpTool = Awaited<ReturnType<Client['listTools']>>['tools'][number]
export type McpCallResult = Awaited<ReturnType<Client['callTool']>>
export type McpCall = (name: string, args: Record<string, unknown>) => Promise<McpCallResult>
export type McpTransport = 'stdio' | 'sse' | 'http'
export type McpProbe = { ok: boolean; transport: McpTransport; toolNames: string[]; error?: string }

// The name the model of a run sees for a server's tool: the CLIs namespace it themselves, Rerun's own
// loop registers it through `mcpToolSet`.
export function mcpToolNameFor(provider: Provider | undefined, serverName: string, toolName: string): string {
    return provider && CLI_PROVIDERS.has(provider) ? `mcp__${serverName}__${toolName}` : `${serverName}_${toolName}`
}

export function resolveTransport(server: McpServer): McpTransport {
    if (server.transport) return server.transport
    if (server.command) return 'stdio'
    if (server.url) return server.url.replace(/\/+$/, '').endsWith('/sse') ? 'sse' : 'http'
    return 'stdio'
}

function buildTransport(server: McpServer, spawn: McpSpawn): Transport | null {
    const kind = resolveTransport(server)
    if (kind === 'stdio') {
        if (!server.command) return null
        const env = { ...spawn.env, ...server.env }
        return new StdioClientTransport({ command: server.command, args: server.args, env, cwd: spawn.cwd })
    }
    if (!server.url) return null
    const url = new URL(server.url)
    const headers = Object.keys(server.headers).length > 0 ? server.headers : undefined
    if (kind === 'http') return new StreamableHTTPClientTransport(url, headers ? { requestInit: { headers } } : undefined)
    return new SSEClientTransport(url, headers ? { requestInit: { headers } } : undefined)
}

// A server may split its tools over several pages: ElevenLabs serves 245 in five, and its first page
// holds nothing but the voice-agent tools.
async function listAllTools(client: Client): Promise<McpTool[]> {
    const tools: McpTool[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    do {
        const page = await client.listTools(cursor ? { cursor } : undefined)
        tools.push(...page.tools)
        cursor = page.nextCursor && !seenCursors.has(page.nextCursor) ? page.nextCursor : undefined
        if (cursor) seenCursors.add(cursor)
    } while (cursor)
    return tools
}

export async function openMcpClient(server: McpServer, spawn: McpSpawn): Promise<{ client: Client; tools: McpTool[] }> {
    const transport = buildTransport(server, spawn)
    if (!transport) throw new Error(`server "${server.name}" needs a command (stdio) or a url (sse/http)`)
    const client = new Client({ name: 'rerun-engine', version: '1.0.0' })
    try {
        await client.connect(transport)
        return { client, tools: await listAllTools(client) }
    } catch (e) {
        await client.close().catch(() => {})
        throw e
    }
}

// `client.callTool` checks `structuredContent` against the tool's outputSchema even on an error, so a
// server whose error result breaks its own schema (Kie.ai answers `{ success: false, error }` where it
// promises a task_id) read as "does not match the tool's output schema" and its reason was lost. The
// error goes out without its structured part.
export async function callMcpTool(client: Client, name: string, args: Record<string, unknown>, options?: RequestOptions): Promise<McpCallResult> {
    const result = await client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema, options)
    if (!result.isError) return result
    const { structuredContent: _structuredContent, ...error } = result
    return error
}

// A tool as the model may be handed it, whichever provider carries it: a root union Anthropic would
// refuse is lifted into plain properties, and the rule it carried is appended to the description.
export function modelReadyMcpTool(serverName: string, tool: McpTool): McpTool {
    const { schema, note } = toToolInputSchema(tool.inputSchema)
    if (schema === tool.inputSchema) return tool
    logger.debug({ server: serverName, tool: tool.name }, 'mcp: tool schema normalised')
    const description = tool.description ?? tool.name
    return { ...tool, description: note ? `${description}\n\n${note}` : description, inputSchema: schema as McpTool['inputSchema'] }
}

// The server's tools as AI SDK tools named `<server>_<tool>`, for the providers the engine drives itself.
export function mcpToolSet(serverName: string, tools: McpTool[], call: McpCall): ToolSet {
    const set: ToolSet = {}
    for (const original of tools) {
        const t = modelReadyMcpTool(serverName, original)
        set[mcpToolNameFor(undefined, serverName, t.name)] = dynamicTool({
            description: t.description ?? t.name,
            inputSchema: jsonSchema(t.inputSchema),
            execute: async args => JSON.stringify((await call(t.name, args as Record<string, unknown>)).content),
        })
    }
    return set
}

// The only way to turn a stored server into a dialable one, and the order is forced: the OAuth
// bearer first, then the `${file:VAR}`s written to their files, then the agent's ${VAR}s — the url has to be resolved before it can be recognised
// as ours — then the hub identity headers last, so they are literal and final. An `npx` launch is
// swapped for the package installed once, when it is. `${RERUN_WORKSPACE}` names the agent's own
// workspace, for a server that needs an absolute folder (the mail server's attachment root).
// `hubAgentId` is who the hub sees calling: the agent itself, or the coworker a delegate works for.
//
// A server of a Vault item resolves its ${VAR}s against that item's secrets only, never the
// coworker's nor another item's, and takes its bearer from the item's own token. `${RERUN_AGENT_ID}`
// names the coworker calling, which an item shared by several cannot carry as a literal.
export async function prepareMcpServer(agentId: string, server: AgentMcpServer, env: Record<string, string>, hubAgentId = agentId): Promise<McpServer> {
    const { vaultItemId, ...plain } = server
    if (vaultItemId) {
        const item = findVaultItem(vaultItemId)
        const resolvable = { ...(item?.env ?? {}), RERUN_WORKSPACE: workspaceDir(agentId), RERUN_AGENT_ID: hubAgentId }
        const { vaultItemId: _tag, ...authed } = (await withAuth(agentId, server)) as AgentMcpServer
        // A command the item starts reads its secrets from its environment, as a package installed
        // with an API key expects to: the item's own, which the spawn of the coworker no longer carries.
        // A variable the server reads as a file reaches it as a path only, never as its value.
        const asFiles = fileVariables(authed)
        const itemEnv = Object.fromEntries(Object.entries(item?.env ?? {}).filter(([key]) => !asFiles.has(key)))
        const withItemEnv = authed.command ? { ...authed, env: { ...itemEnv, ...authed.env } } : authed
        const withFiles = await materializeFileSecrets(withItemEnv, resolvable, vaultMcpCredentialsDir(vaultItemId))
        return withInstalledPackage(withHubHeaders(resolveServerSecrets(withFiles, resolvable), hubAgentId, vaultItemId))
    }
    const resolvable = { ...env, RERUN_WORKSPACE: workspaceDir(agentId) }
    const withFiles = await materializeFileSecrets(await withAuth(agentId, plain), resolvable, agentMcpCredentialsDir(agentId))
    return withInstalledPackage(withHubHeaders(resolveServerSecrets(withFiles, resolvable), hubAgentId))
}

export class McpProbeTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`no answer within ${Math.round(timeoutMs / 1000)}s`)
    }
}

// A client that answers after the deadline is closed as soon as it shows up, so a slow stdio
// server never outlives the probe that gave up on it.
async function withDeadline<T extends { client: Client }>(opening: Promise<T>, timeoutMs: number | undefined): Promise<T> {
    if (timeoutMs === undefined) return opening
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new McpProbeTimeoutError(timeoutMs)), timeoutMs)
    })
    try {
        return await Promise.race([opening, deadline])
    } catch (e) {
        if (e instanceof McpProbeTimeoutError) opening.then(({ client }) => client.close()).catch(() => {})
        throw e
    } finally {
        clearTimeout(timer)
    }
}

// The SDK keeps the HTTP status on `code` and only quotes the response body in the message, so a
// bare 401 (Linear answers one with an empty body) would read as an unexplained failure, never as a
// sign-in to make.
function probeErrorMessage(e: unknown): string {
    const message = (e as Error).message
    const code = (e as { code?: unknown }).code
    return typeof code === 'number' && code >= 400 && !message.includes(String(code)) ? `${message.trimEnd()} (HTTP ${code})` : message
}

export async function probeMcp(agentId: string, server: AgentMcpServer, env: Record<string, string>, opts: { spawn: McpSpawn; timeoutMs?: number }): Promise<McpProbe> {
    const transport = resolveTransport(server)
    try {
        const opening = prepareMcpServer(agentId, server, env).then(prepared => openMcpClient(prepared, opts.spawn))
        const { client, tools } = await withDeadline(opening, opts.timeoutMs)
        const toolNames = tools.map(t => t.name)
        await client.close().catch(() => {})
        return { ok: true, transport, toolNames }
    } catch (e) {
        return { ok: false, transport, toolNames: [], error: probeErrorMessage(e) }
    }
}
