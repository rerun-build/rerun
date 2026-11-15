import { REWIND_HOURS_PER_WEEK, type RewindAgentReport, type RewindRunOutput } from '@rerun/contracts'
import { BRIDGE_SERVER_NAME } from '../agents/types.js'

const HOUR_MS = 60 * 60 * 1000
const TOP_TOOLS = 8
const OUTPUT_RUNS = 8
export const OUTPUT_MAX_CHARS = 700

export type RewindRunRow = {
    id: string
    sessionId: string
    status: string
    triggerSource: string | null
    model: string | null
    totalTokens: number | null
    costMicros: number | null
    startedAt: string
    finishedAt: string | null
}

export type RewindToolRow = { toolName: string; calls: number; errors: number }

export type RewindReportInput = {
    from: string
    to: string
    runs: RewindRunRow[]
    tools: RewindToolRow[]
    mcpServerNames: string[]
    connectorSlugs: Map<string, string>
    sessionTitles: Map<string, string>
    sessions: number
    calledBy: { agentId: string; count: number }[]
    memoriesCreated: number
    topRecalledMemory: { content: string; accessCount: number } | null
    outputs: RewindRunOutput[]
}

type Counter = Map<string, number>

function bump(counter: Counter, key: string, by = 1): void {
    counter.set(key, (counter.get(key) ?? 0) + by)
}

function ranked(counter: Counter, limit?: number): { name: string; count: number }[] {
    const sorted = [...counter].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    return limit === undefined ? sorted : sorted.slice(0, limit)
}

export function runDurationMs(run: Pick<RewindRunRow, 'startedAt' | 'finishedAt'>): number {
    if (!run.finishedAt) return 0
    return Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt))
}

export function connectorOfTool(toolName: string, serverNames: string[]): string | null {
    let match: string | null = null
    for (const server of serverNames) {
        if (server === BRIDGE_SERVER_NAME) continue
        const owns = toolName.startsWith(`mcp__${server}__`) || toolName.startsWith(`${server}_`)
        if (owns && (!match || server.length > match.length)) match = server
    }
    return match
}

export function longestDoneRun(runs: RewindRunRow[]): RewindRunRow | null {
    let longest: RewindRunRow | null = null
    for (const run of runs) {
        if (run.status !== 'done' || runDurationMs(run) === 0) continue
        if (!longest || runDurationMs(run) > runDurationMs(longest)) longest = run
    }
    return longest
}

export function pickOutputRuns(runs: RewindRunRow[], limit = OUTPUT_RUNS): RewindRunRow[] {
    const automated = (run: RewindRunRow) => (run.triggerSource && run.triggerSource !== 'chat' ? 1 : 0)
    return runs
        .filter(run => run.status === 'done')
        .sort((a, b) => automated(b) - automated(a) || runDurationMs(b) - runDurationMs(a))
        .slice(0, limit)
}

export function buildAgentReport(input: RewindReportInput): RewindAgentReport {
    const fromMs = Date.parse(input.from)
    const hourly = new Array<number>(REWIND_HOURS_PER_WEEK).fill(0)
    const bySource: Counter = new Map()
    const models: Counter = new Map()
    const runs = { total: 0, done: 0, error: 0, cancelled: 0 }
    let workedMs = 0
    let tokens = 0
    let costMicros: number | null = null

    for (const run of input.runs) {
        runs.total += 1
        if (run.status === 'done') runs.done += 1
        else if (run.status === 'error') runs.error += 1
        else if (run.status === 'cancelled') runs.cancelled += 1

        const hour = Math.floor((Date.parse(run.startedAt) - fromMs) / HOUR_MS)
        if (hour >= 0 && hour < REWIND_HOURS_PER_WEEK) hourly[hour] += 1

        bump(bySource, run.triggerSource ?? 'chat')
        if (run.model) bump(models, run.model)
        tokens += run.totalTokens ?? 0
        if (run.costMicros !== null) costMicros = (costMicros ?? 0) + run.costMicros

        workedMs += runDurationMs(run)
    }

    const longest = longestDoneRun(input.runs)
    const builtinTools: Counter = new Map()
    const connectors: Counter = new Map()
    let toolTotal = 0
    let toolErrors = 0
    for (const row of input.tools) {
        toolTotal += row.calls
        toolErrors += row.errors
        const connector = connectorOfTool(row.toolName, input.mcpServerNames)
        if (connector) bump(connectors, input.connectorSlugs.get(connector) ?? connector, row.calls)
        else bump(builtinTools, row.toolName.replace(`mcp__${BRIDGE_SERVER_NAME}__`, ''), row.calls)
    }

    return {
        from: input.from,
        to: input.to,
        runs,
        workedMs,
        hourly,
        bySource: ranked(bySource),
        models: ranked(models),
        tokens,
        costMicros,
        longestRun: longest
            ? {
                  runId: longest.id,
                  durationMs: runDurationMs(longest),
                  startedAt: longest.startedAt,
                  title: input.sessionTitles.get(longest.sessionId) ?? 'Untitled',
              }
            : null,
        tools: { total: toolTotal, errors: toolErrors, top: ranked(builtinTools, TOP_TOOLS) },
        connectors: ranked(connectors),
        calledBy: input.calledBy,
        sessions: input.sessions,
        memories: { created: input.memoriesCreated, topRecalled: input.topRecalledMemory },
        outputs: input.outputs,
    }
}
