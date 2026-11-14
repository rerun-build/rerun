import { REWIND_HOURS_PER_WEEK, type RewindAgentReport, type RewindAwardId, type RewindHighlight, type RewindPayload } from '@rerun/contracts'
import type { RewindWeek } from './week'

const TOP_TOOLS = 8
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5])

const AWARD_FLOOR: Record<RewindAwardId, number> = {
    'night-owl': 3,
    marathon: 60_000,
    flawless: 5,
    toolsmith: 10,
    'connector-hub': 2,
    'team-player': 1,
}

export type RewindAgentInput = {
    agentId: string
    engineAgentId: string
    spaceId: string
    name: string
    spaceName: string | null
    report: RewindAgentReport | null
}

export type ReportedAgent = RewindAgentInput & { report: RewindAgentReport }

export type ConnectorCatalog = Map<string, { name: string; icon: string | null }>

export type RewindMergeInput = {
    week: RewindWeek
    agents: RewindAgentInput[]
    catalog: ConnectorCatalog
    previous: { runs: number; workedMs: number } | null
    highlights: RewindHighlight[]
}

function hasReport(agent: RewindAgentInput): agent is ReportedAgent {
    return agent.report !== null
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
    return items.reduce((total, item) => total + pick(item), 0)
}

function bestBy<T>(items: T[], score: (item: T) => number): { item: T; score: number } | null {
    let best: { item: T; score: number } | null = null
    for (const item of items) {
        const value = score(item)
        if (!best || value > best.score) best = { item, score: value }
    }
    return best
}

function nightRuns(report: RewindAgentReport): number {
    return report.hourly.reduce((total, runs, hour) => (NIGHT_HOURS.has(hour % 24) ? total + runs : total), 0)
}

export function connectorSlugsOf(agents: RewindAgentInput[]): string[] {
    return [...new Set(agents.flatMap(agent => agent.report?.connectors.map(connector => connector.name) ?? []))]
}

export function collaborationsOf(agents: ReportedAgent[]): RewindPayload['collaborations'] {
    const byEngineId = new Map(agents.map(agent => [`${agent.spaceId}:${agent.engineAgentId}`, agent.agentId]))
    const collaborations: RewindPayload['collaborations'] = []
    for (const callee of agents) {
        for (const caller of callee.report.calledBy) {
            const fromAgentId = byEngineId.get(`${callee.spaceId}:${caller.agentId}`)
            if (fromAgentId && fromAgentId !== callee.agentId) collaborations.push({ fromAgentId, toAgentId: callee.agentId, count: caller.count })
        }
    }
    return collaborations.sort((a, b) => b.count - a.count)
}

function awardsOf(active: ReportedAgent[], collaborations: RewindPayload['collaborations']): RewindPayload['awards'] {
    const collaborationCount = (agentId: string) => sumBy(collaborations.filter(c => c.fromAgentId === agentId || c.toAgentId === agentId), c => c.count)
    const scorers: Record<RewindAwardId, (agent: ReportedAgent) => number> = {
        'night-owl': agent => nightRuns(agent.report),
        marathon: agent => agent.report.longestRun?.durationMs ?? 0,
        flawless: agent => (agent.report.runs.error === 0 ? agent.report.runs.done : 0),
        toolsmith: agent => agent.report.tools.total,
        'connector-hub': agent => agent.report.connectors.length,
        'team-player': agent => collaborationCount(agent.agentId),
    }

    const awards: RewindPayload['awards'] = []
    for (const id of Object.keys(scorers) as RewindAwardId[]) {
        const best = bestBy(active, scorers[id])
        if (best && best.score >= AWARD_FLOOR[id]) awards.push({ id, agentId: best.item.agentId, value: best.score })
    }
    return awards
}

export function mergeRewind(input: RewindMergeInput): RewindPayload {
    const reported = input.agents.filter(hasReport)
    const active = reported.filter(agent => agent.report.runs.total > 0)
    const reports = reported.map(agent => agent.report)

    const hourly = new Array<number>(REWIND_HOURS_PER_WEEK).fill(0)
    for (const report of reports) report.hourly.forEach((runs, hour) => (hourly[hour] += runs))

    const costs = reports.map(report => report.costMicros).filter((cost): cost is number => cost !== null)

    const agents = active
        .map(agent => ({
            agentId: agent.agentId,
            name: agent.name,
            spaceName: agent.spaceName,
            runs: agent.report.runs.total,
            errors: agent.report.runs.error,
            workedMs: agent.report.workedMs,
            topTools: agent.report.tools.top.slice(0, 3).map(tool => tool.name),
            connectors: agent.report.connectors.map(connector => connector.name),
        }))
        .sort((a, b) => b.runs - a.runs || b.workedMs - a.workedMs)

    const connectors = new Map<string, { calls: number; agents: number }>()
    const tools = new Map<string, number>()
    for (const report of reports) {
        for (const connector of report.connectors) {
            const entry = connectors.get(connector.name) ?? { calls: 0, agents: 0 }
            connectors.set(connector.name, { calls: entry.calls + connector.count, agents: entry.agents + 1 })
        }
        for (const tool of report.tools.top) tools.set(tool.name, (tools.get(tool.name) ?? 0) + tool.count)
    }

    const collaborations = collaborationsOf(reported)
    const longest = bestBy(
        reported.filter(agent => agent.report.longestRun),
        agent => agent.report.longestRun!.durationMs
    )
    const memory = bestBy(
        reported.filter(agent => agent.report.memories.topRecalled),
        agent => agent.report.memories.topRecalled!.accessCount
    )

    return {
        version: 1,
        weekStart: input.week.from,
        weekEnd: input.week.to,
        totals: {
            runs: sumBy(reports, r => r.runs.total),
            done: sumBy(reports, r => r.runs.done),
            errors: sumBy(reports, r => r.runs.error),
            workedMs: sumBy(reports, r => r.workedMs),
            tokens: sumBy(reports, r => r.tokens),
            costMicros: costs.length ? sumBy(costs, cost => cost) : null,
            toolCalls: sumBy(reports, r => r.tools.total),
            sessions: sumBy(reports, r => r.sessions),
            memoriesCreated: sumBy(reports, r => r.memories.created),
            activeAgents: active.length,
            unreachableAgents: input.agents.length - reported.length,
        },
        previous: input.previous,
        hourly,
        agents,
        mvpAgentId: agents[0]?.agentId ?? null,
        connectors: [...connectors]
            .map(([slug, entry]) => ({ slug, name: input.catalog.get(slug)?.name ?? slug, icon: input.catalog.get(slug)?.icon ?? null, ...entry }))
            .sort((a, b) => b.calls - a.calls),
        topTools: [...tools]
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, TOP_TOOLS),
        collaborations,
        longestRun: longest
            ? { agentId: longest.item.agentId, durationMs: longest.score, title: longest.item.report.longestRun!.title }
            : null,
        topMemory: memory
            ? { agentId: memory.item.agentId, content: memory.item.report.memories.topRecalled!.content, accessCount: memory.score }
            : null,
        highlights: input.highlights,
        awards: awardsOf(active, collaborations),
    }
}
