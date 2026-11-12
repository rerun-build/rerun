import { createHash } from 'node:crypto'
import type { ToolSet } from 'ai'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { LoadedAgent, McpServer } from '../agents/types.js'
import { agentProcessEnv } from '../agents/process-env.js'
import { childProcessEnv } from '../lib/child-env.js'
import { logger } from '../lib/logger.js'
import { mcpToolSet, openMcpClient, prepareMcpServer, resolveTransport, type McpCallResult, type McpSpawn, type McpTool } from './mcp.js'

// A CLI provider starts a new process for every message, and that process used to connect to every
// MCP server of the agent before calling the model: up to several seconds per message. The engine
// keeps the connections instead, so only the first message after a quiet spell pays for them.
export const MCP_IDLE_MS = 10 * 60 * 1000
// A server that has not answered by then is left out of this run rather than holding it up. Its
// attempt is dropped too, so the next run dials it afresh instead of waiting on the same one.
export const MCP_CONNECT_TIMEOUT_MS = 20_000

type CallResult = McpCallResult
type Session = { client: Client; tools: McpTool[] }
type Entry = { fingerprint: string; opening: Promise<Session>; inFlight: number; timer?: NodeJS.Timeout }

export type PooledMcp = {
    name: string
    tools: McpTool[]
    call: (name: string, args: Record<string, unknown>, options?: RequestOptions) => Promise<CallResult>
}

const entries = new Map<string, Entry>()

const keyOf = (agentId: string, name: string) => `${agentId}\u0000${name}`

// Anything that changes how the server is dialed: a refreshed OAuth bearer, an edited command, a
// new agent key. The connection opened with the old values is dropped for a new one.
function fingerprintOf(server: McpServer, spawn: McpSpawn): string {
    const dialed = [resolveTransport(server), server.command, server.args, server.env, server.url, server.headers, spawn.cwd, spawn.env]
    return createHash('sha256').update(JSON.stringify(dialed)).digest('hex')
}

function drop(key: string, entry: Entry): Promise<void> {
    if (entries.get(key) !== entry) return Promise.resolve()
    entries.delete(key)
    clearTimeout(entry.timer)
    return entry.opening.then(({ client }) => client.close()).catch(() => {})
}

// The idle clock only runs while no call is out: a tool that takes longer than the idle spell keeps
// its connection until it answers.
function arm(key: string, entry: Entry): void {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
        if (entry.inFlight > 0) return arm(key, entry)
        logger.debug({ server: key.split('\u0000')[1] }, 'mcp: idle connection closed')
        drop(key, entry)
    }, MCP_IDLE_MS)
    entry.timer.unref()
}

function entryFor(agentId: string, server: McpServer, spawn: McpSpawn): { key: string; entry: Entry } {
    const key = keyOf(agentId, server.name)
    const fingerprint = fingerprintOf(server, spawn)
    const current = entries.get(key)
    if (current?.fingerprint === fingerprint) return { key, entry: current }
    if (current) drop(key, current)
    const entry: Entry = { fingerprint, opening: openMcpClient(server, spawn), inFlight: 0 }
    entries.set(key, entry)
    entry.opening.then(
        ({ client }) => {
            client.onclose = () => drop(key, entry)
        },
        () => drop(key, entry)
    )
    return { key, entry }
}

type Live = { key: string; entry: Entry; session: Session }

// The connection the agent already has to this server, or a new one. A server that cannot be reached
// answers null and is tried again on the next call, never kept as failed.
async function connect(agentId: string, server: McpServer, spawn: McpSpawn): Promise<Live | null> {
    const { key, entry } = entryFor(agentId, server, spawn)
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${MCP_CONNECT_TIMEOUT_MS / 1000}s`)), MCP_CONNECT_TIMEOUT_MS)
    })
    try {
        const session = await Promise.race([entry.opening, deadline])
        arm(key, entry)
        return { key, entry, session }
    } catch (e) {
        drop(key, entry)
        logger.warn({ server: server.name, transport: resolveTransport(server), err: (e as Error).message }, 'mcp connect failed')
        return null
    } finally {
        clearTimeout(timer)
    }
}

// A run holds the handle for as long as it lasts, which can outlive the connection it was given:
// closed as idle between two of its calls, or dropped by the server. A call made on a connection
// the pool no longer holds dials the server again rather than failing on the closed client.
export async function acquireMcp(agentId: string, server: McpServer, spawn: McpSpawn): Promise<PooledMcp | null> {
    const first = await connect(agentId, server, spawn)
    if (!first) return null
    return {
        name: server.name,
        tools: first.session.tools,
        call: async (name, args, options) => {
            const live = entries.get(first.key) === first.entry ? first : await connect(agentId, server, spawn)
            if (!live) throw new Error(`server "${server.name}" unreachable`)
            live.entry.inFlight++
            try {
                return await live.session.client.callTool({ name, arguments: args }, undefined, options)
            } finally {
                live.entry.inFlight--
                arm(live.key, live.entry)
            }
        },
    }
}

// The environment a stdio server got when the CLI started it: what the engine inherits to any
// agent process (PATH, HOME, locale…), the agent's keys, and its workspace as the working
// directory. Never the engine's secrets, which a package fetched from npm has no business reading.
export function agentMcpSpawn(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>): McpSpawn {
    const { cwd, env } = agentProcessEnv(agent)
    return { cwd, env: childProcessEnv(env) }
}

// For the providers the engine drives itself: the agent's MCP tools, served by the pooled connections.
export async function pooledMcpTools(agent: LoadedAgent): Promise<ToolSet> {
    const spawn = agentMcpSpawn(agent)
    const prepared = await Promise.all(agent.config.mcpServers.map(server => prepareMcpServer(agent.id, server, agent.env, agent.hubAgentId)))
    const pooled = await Promise.all(prepared.map(server => acquireMcp(agent.id, server, spawn)))
    const tools: ToolSet = {}
    for (const server of pooled)
        if (server)
            Object.assign(
                tools,
                mcpToolSet(server.name, server.tools, (name, args) => server.call(name, args))
            )
    return tools
}

// The agent's connections are closed rather than left to idle out, all of them or those to the
// servers it no longer declares.
export function releaseAgentMcp(agentId: string, keep: string[] = []): void {
    const prefix = `${agentId}\u0000`
    for (const [key, entry] of entries) if (key.startsWith(prefix) && !keep.includes(key.slice(prefix.length))) drop(key, entry)
}

export async function closeAllMcp(): Promise<void> {
    await Promise.all([...entries].map(([key, entry]) => drop(key, entry)))
}

export function pooledMcpCount(): number {
    return entries.size
}
