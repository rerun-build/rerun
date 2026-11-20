import { createHash } from 'node:crypto'
import type { ToolSet } from 'ai'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { LoadedAgent, McpServer } from '../agents/types.js'
import { agentProcessEnv } from '../agents/process-env.js'
import { childProcessEnv } from '../lib/child-env.js'
import { logger } from '../lib/logger.js'
import { isAuthError } from './mcp-auth.js'
import { callMcpTool, mcpToolSet, openMcpClient, prepareMcpServer, resolveTransport, type McpCallResult, type McpSpawn, type McpTool } from './mcp.js'

export const MCP_IDLE_MS = 10 * 60 * 1000
export const MCP_CONNECT_TIMEOUT_MS = 20_000

type CallResult = McpCallResult
type Session = { client: Client; tools: McpTool[] }
type Entry = { fingerprint: string; opening: Promise<Session>; inFlight: number; ready: boolean; toolCount?: number; timer?: NodeJS.Timeout }

export type PooledMcp = {
    name: string
    tools: McpTool[]
    call: (name: string, args: Record<string, unknown>, options?: RequestOptions) => Promise<CallResult>
}

export type McpErrorClass = 'auth' | 'timeout' | 'unreachable' | 'closed' | 'other'

const entries = new Map<string, Entry>()
const failures = new Map<string, McpErrorClass>()
const lastCounts = new Map<string, number>()

export function errorClassOf(error: unknown): McpErrorClass {
    const message = error instanceof Error ? error.message : String(error ?? '')
    const code = (error as { code?: unknown } | null)?.code
    if (isAuthError(message)) return 'auth'
    if (message.startsWith('no answer within')) return 'timeout'
    if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(code as string) || /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/.test(message) || message === 'fetch failed') return 'unreachable'
    if ((error instanceof McpError && code === -32000) || code === 'EPIPE' || code === 'ECONNRESET') return 'closed'
    return 'other'
}

const keyOf = (agentId: string, name: string) => `${agentId}\u0000${name}`

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
    const entry: Entry = { fingerprint, opening: openMcpClient(server, spawn), inFlight: 0, ready: false }
    entries.set(key, entry)
    entry.opening.then(
        ({ client, tools }) => {
            entry.ready = true
            entry.toolCount = tools.length
            lastCounts.set(key, tools.length)
            client.onclose = () => drop(key, entry)
        },
        () => drop(key, entry)
    )
    return { key, entry }
}

type Live = { key: string; entry: Entry; session: Session }

async function connect(agentId: string, server: McpServer, spawn: McpSpawn): Promise<Live | null> {
    const { key, entry } = entryFor(agentId, server, spawn)
    let timer: NodeJS.Timeout | undefined
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${MCP_CONNECT_TIMEOUT_MS / 1000}s`)), MCP_CONNECT_TIMEOUT_MS)
    })
    try {
        const session = await Promise.race([entry.opening, deadline])
        failures.delete(key)
        arm(key, entry)
        return { key, entry, session }
    } catch (e) {
        failures.set(key, errorClassOf(e))
        drop(key, entry)
        logger.warn({ server: server.name, transport: resolveTransport(server), err: (e as Error).message }, 'mcp connect failed')
        return null
    } finally {
        clearTimeout(timer)
    }
}

function isConnectionLost(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code
    return (error instanceof McpError && code === -32000) || code === 'EPIPE' || code === 'ECONNRESET'
}

async function callOn(live: Live, name: string, args: Record<string, unknown>, options?: RequestOptions): Promise<CallResult> {
    live.entry.inFlight++
    try {
        return await callMcpTool(live.session.client, name, args, options)
    } finally {
        live.entry.inFlight--
        arm(live.key, live.entry)
    }
}

export async function acquireMcp(agentId: string, server: McpServer, spawn: McpSpawn): Promise<PooledMcp | null> {
    const first = await connect(agentId, server, spawn)
    if (!first) return null
    const picked = server.tools?.length ? new Set(server.tools) : null
    return {
        name: server.name,
        tools: picked ? first.session.tools.filter(tool => picked.has(tool.name)) : first.session.tools,
        call: async (name, args, options) => {
            if (picked && !picked.has(name)) throw new Error(`tool "${name}" is not picked for server "${server.name}"`)
            const live = entries.get(first.key) === first.entry ? first : await connect(agentId, server, spawn)
            if (!live) throw new Error(`server "${server.name}" unreachable`)
            try {
                return await callOn(live, name, args, options)
            } catch (e) {
                if (!isConnectionLost(e) || options?.signal?.aborted) throw e
                logger.info({ server: server.name }, 'mcp: connection lost, reconnecting once')
                void drop(live.key, live.entry)
                const fresh = await connect(agentId, server, spawn)
                if (!fresh) throw new Error(`server "${server.name}" unreachable`)
                return await callOn(fresh, name, args, options)
            }
        },
    }
}

export function agentMcpSpawn(agent: Pick<LoadedAgent, 'id' | 'env' | 'config'>): McpSpawn {
    const { cwd, env } = agentProcessEnv(agent)
    return { cwd, env: childProcessEnv(env) }
}

export async function pooledMcpServers(agent: LoadedAgent): Promise<PooledMcp[]> {
    const spawn = agentMcpSpawn(agent)
    const prepared = await Promise.all(agent.config.mcpServers.map(server => prepareMcpServer(agent.id, server, agent.env, agent.hubAgentId)))
    const pooled = await Promise.all(prepared.map(server => acquireMcp(agent.id, server, spawn)))
    return pooled.filter(server => server !== null)
}

export function pooledMcpToolSet(servers: PooledMcp[]): ToolSet {
    const tools: ToolSet = {}
    for (const server of servers)
        Object.assign(
            tools,
            mcpToolSet(server.name, server.tools, (name, args) => server.call(name, args))
        )
    return tools
}

export function releaseAgentMcp(agentId: string, keep: string[] = []): void {
    const prefix = `${agentId}\u0000`
    for (const [key, entry] of entries) if (key.startsWith(prefix) && !keep.includes(key.slice(prefix.length))) drop(key, entry)
    for (const key of [...failures.keys()]) if (key.startsWith(prefix) && !keep.includes(key.slice(prefix.length))) failures.delete(key)
}

export async function closeAllMcp(): Promise<void> {
    failures.clear()
    lastCounts.clear()
    await Promise.all([...entries].map(([key, entry]) => drop(key, entry)))
}

export function pooledMcpCount(): number {
    return entries.size
}

export function reconnectMcp(agentId: string, name: string): boolean {
    const key = keyOf(agentId, name)
    const entry = entries.get(key)
    if (!entry) {
        failures.delete(key)
        return false
    }
    void drop(key, entry)
    return true
}

type McpSessionState = { name: string; state: 'connected' | 'connecting' | 'failed'; errorClass?: McpErrorClass; toolCount?: number }

export function mcpSessionStates(agentId: string): McpSessionState[] {
    const prefix = `${agentId}\u0000`
    const states: McpSessionState[] = []
    for (const [key, entry] of entries)
        if (key.startsWith(prefix)) {
            const name = key.slice(prefix.length)
            states.push(entry.ready ? { name, state: 'connected', toolCount: entry.toolCount } : { name, state: 'connecting' })
        }
    for (const [key, errorClass] of failures) if (key.startsWith(prefix) && !entries.has(key)) states.push({ name: key.slice(prefix.length), state: 'failed', errorClass })
    return states.sort((a, b) => a.name.localeCompare(b.name))
}

export function mcpLastToolCounts(agentId: string): Map<string, number> {
    const prefix = `${agentId}\u0000`
    const counts = new Map<string, number>()
    for (const [key, count] of lastCounts) if (key.startsWith(prefix)) counts.set(key.slice(prefix.length), count)
    return counts
}
