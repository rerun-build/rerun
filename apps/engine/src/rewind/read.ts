import { and, count, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { parseServiceRegistryKey, type RewindAgentReport } from '@rerun/contracts'
import { getAgent } from '../agents/registry.js'
import { getSystemDb } from '../db/systemDb.js'
import { runs, sessions, toolCalls } from '../db/schema.js'
import { collectAssistantText } from '../db/repos/messages.js'
import { readRegistry } from '../services/registry.js'
import { agentMcpServers, attachedVaultItems } from '../vault/runtime.js'
import type { LoadedAgent } from '../agents/types.js'
import { buildAgentReport, longestDoneRun, OUTPUT_MAX_CHARS, pickOutputRuns, type RewindRunRow } from './report.js'

const MAX_RUNS = 20000

function clip(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > OUTPUT_MAX_CHARS ? `${flat.slice(0, OUTPUT_MAX_CHARS)}…` : flat
}

// Every account of an app counts toward that app, whatever its registry key or server name, and
// whether the coworker installed it or a Vault item lends it.
async function connectorSlugsByServer(agent: LoadedAgent): Promise<Map<string, string>> {
    const registry = await readRegistry(agent.id)
    const slugs = new Map<string, string>()
    for (const [key, entry] of Object.entries(registry?.services ?? {})) {
        const { slug } = parseServiceRegistryKey(key)
        slugs.set(key, slug)
        if (!entry) continue
        const footprint = entry.mcpServers ?? (entry as { toolNames?: string[] }).toolNames ?? []
        const authTargets = [entry.oauth?.serverName, entry.managed?.serverName, entry.composio?.serverName, entry.app?.serverName]
        for (const name of [...footprint, ...authTargets]) {
            if (typeof name === 'string' && name) slugs.set(name, slug)
        }
    }
    for (const item of attachedVaultItems(agent)) {
        if (!item.config.slug) continue
        for (const server of item.config.mcpServers) slugs.set(server.name, item.config.slug)
    }
    return slugs
}

export async function readAgentRewind(agentId: string, from: string, to: string): Promise<RewindAgentReport> {
    const agent = await getAgent(agentId)
    const { db, client } = await getSystemDb(agentId)

    const runRows: RewindRunRow[] = await db
        .select({
            id: runs.id,
            sessionId: runs.sessionId,
            status: runs.status,
            triggerSource: runs.triggerSource,
            model: runs.model,
            totalTokens: runs.totalTokens,
            costMicros: runs.costMicros,
            startedAt: runs.startedAt,
            finishedAt: runs.finishedAt,
        })
        .from(runs)
        .where(and(eq(runs.agentId, agentId), gte(runs.startedAt, from), lt(runs.startedAt, to)))
        .limit(MAX_RUNS)

    const tools = await db
        .select({
            toolName: toolCalls.toolName,
            calls: sql<number>`count(*)`,
            errors: sql<number>`coalesce(sum(${toolCalls.isError}), 0)`,
        })
        .from(toolCalls)
        .where(and(eq(toolCalls.agentId, agentId), gte(toolCalls.createdAt, from), lt(toolCalls.createdAt, to)))
        .groupBy(toolCalls.toolName)

    const inWindow = and(eq(sessions.agentId, agentId), gte(sessions.createdAt, from), lt(sessions.createdAt, to))
    const [sessionCount] = await db.select({ value: count() }).from(sessions).where(inWindow)
    const calledBy = await db
        .select({ agentId: sql<string>`${sessions.originAgentId}`, count: sql<number>`count(*)` })
        .from(sessions)
        .where(and(inWindow, isNotNull(sessions.originAgentId)))
        .groupBy(sessions.originAgentId)

    const outputRuns = pickOutputRuns(runRows)
    const longest = longestDoneRun(runRows)
    const titledSessionIds = [...new Set([...outputRuns, ...(longest ? [longest] : [])].map(run => run.sessionId))]
    const titleRows = titledSessionIds.length
        ? await db.select({ id: sessions.id, title: sessions.title }).from(sessions).where(inArray(sessions.id, titledSessionIds))
        : []
    const sessionTitles = new Map(titleRows.map(row => [row.id, row.title]))

    const outputs = []
    for (const run of outputRuns) {
        const text = clip(await collectAssistantText(agentId, run.sessionId, run.startedAt, run.finishedAt))
        if (!text) continue
        outputs.push({
            runId: run.id,
            startedAt: run.startedAt,
            source: run.triggerSource ?? 'chat',
            title: sessionTitles.get(run.sessionId) ?? 'Untitled',
            text,
        })
    }

    const created = await client.execute({
        sql: 'SELECT count(*) AS n FROM memories WHERE agent_id = ? AND created_at >= ? AND created_at < ?',
        args: [agentId, from, to],
    })
    const recalled = await client.execute({
        sql: 'SELECT content, access_count FROM memories WHERE agent_id = ? AND access_count > 0 AND last_accessed_at >= ? AND last_accessed_at < ? ORDER BY access_count DESC LIMIT 1',
        args: [agentId, from, to],
    })
    const topRow = recalled.rows[0]

    return buildAgentReport({
        from,
        to,
        runs: runRows,
        tools: tools.map(row => ({ toolName: row.toolName, calls: Number(row.calls), errors: Number(row.errors) })),
        mcpServerNames: agentMcpServers(agent).map(server => server.name),
        connectorSlugs: await connectorSlugsByServer(agent),
        sessionTitles,
        sessions: sessionCount?.value ?? 0,
        calledBy: calledBy.map(row => ({ agentId: row.agentId, count: Number(row.count) })),
        memoriesCreated: Number(created.rows[0]?.n ?? 0),
        topRecalledMemory: topRow ? { content: clip(String(topRow.content)), accessCount: Number(topRow.access_count) } : null,
        outputs,
    })
}
