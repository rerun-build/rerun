import { REWIND_HOURS_PER_WEEK, type RewindAgentReport, type RewindPayload } from '@rerun/contracts'
import { mergeRewind, type ConnectorCatalog, type RewindAgentInput } from './merge'
import { rewindWeekStarting } from './week'

const HOUR_MS = 60 * 60 * 1000
export const FIXTURE_WEEK = rewindWeekStarting(new Date('2026-09-07T00:00:00.000Z'))

export function agentReport(partial: Partial<RewindAgentReport> = {}): RewindAgentReport {
    return {
        from: FIXTURE_WEEK.from,
        to: FIXTURE_WEEK.to,
        runs: { total: 0, done: 0, error: 0, cancelled: 0 },
        workedMs: 0,
        hourly: new Array(REWIND_HOURS_PER_WEEK).fill(0),
        bySource: [],
        models: [],
        tokens: 0,
        costMicros: null,
        longestRun: null,
        tools: { total: 0, errors: 0, top: [] },
        connectors: [],
        calledBy: [],
        sessions: 0,
        memories: { created: 0, topRecalled: null },
        outputs: [],
        ...partial,
    }
}

function hourlyFrom(seed: number, busyHours: number[], scale: number): number[] {
    return Array.from({ length: REWIND_HOURS_PER_WEEK }, (_, hour) => {
        const day = Math.floor(hour / 24)
        const base = busyHours.includes(hour % 24) ? scale : 0
        const weekend = day >= 5 ? 0.4 : 1
        return Math.round(base * weekend * (0.6 + (((hour * 7 + seed * 13) % 10) / 10) * 0.8))
    })
}

function sum(values: number[]): number {
    return values.reduce((a, b) => a + b, 0)
}

type RichAgentShape = { seed: number; busyHours: number[]; scale: number; errorRate: number }

function richAgent(agentId: string, name: string, spaceName: string, shape: RichAgentShape, partial: Partial<RewindAgentReport>): RewindAgentInput {
    const hourly = hourlyFrom(shape.seed, shape.busyHours, shape.scale)
    const total = sum(hourly)
    const errors = Math.round(total * shape.errorRate)
    return {
        agentId,
        engineAgentId: `engine-${agentId}`,
        spaceId: 'space-growth',
        name,
        spaceName,
        report: agentReport({
            hourly,
            runs: { total, done: total - errors, error: errors, cancelled: 0 },
            workedMs: total * (2 + shape.seed) * 60_000,
            tokens: total * 18_000,
            sessions: Math.round(total * 0.7),
            ...partial,
        }),
    }
}

const RICH_AGENTS: RewindAgentInput[] = [
    richAgent('agent-scout', 'Scout', 'Growth', { seed: 1, busyHours: [8, 9, 10, 14, 15, 16], scale: 3, errorRate: 0.04 }, {
        tools: { total: 412, errors: 9, top: [{ name: 'web_search', count: 188 }, { name: 'web_fetch', count: 131 }, { name: 'fs_write', count: 42 }] },
        connectors: [{ name: 'hubspot', count: 96 }, { name: 'gmail', count: 54 }],
        longestRun: { runId: 'r1', durationMs: 47 * 60_000, startedAt: FIXTURE_WEEK.from, title: 'Enrich 120 SaaS leads' },
        memories: { created: 14, topRecalled: { content: 'Our ICP is B2B SaaS teams of 20 to 200 people selling to finance leaders.', accessCount: 31 } },
    }),
    richAgent('agent-quill', 'Quill', 'Growth', { seed: 2, busyHours: [1, 2, 3, 6, 7], scale: 2, errorRate: 0 }, {
        tools: { total: 188, errors: 0, top: [{ name: 'web_search', count: 64 }, { name: 'fs_edit', count: 58 }, { name: 'publish_file', count: 4 }] },
        connectors: [{ name: 'notion', count: 40 }, { name: 'webflow', count: 12 }, { name: 'gmail', count: 3 }],
        calledBy: [{ agentId: 'engine-agent-scout', count: 6 }],
        memories: { created: 5, topRecalled: null },
    }),
    richAgent('agent-inbox', 'Inbox Zero', 'Ops', { seed: 3, busyHours: [7, 12, 18], scale: 4, errorRate: 0.05 }, {
        tools: { total: 640, errors: 22, top: [{ name: 'memory_search', count: 90 }, { name: 'notify_user', count: 21 }] },
        connectors: [{ name: 'gmail', count: 520 }, { name: 'slack', count: 70 }],
        calledBy: [{ agentId: 'engine-agent-quill', count: 2 }],
    }),
]

const FIXTURE_CONNECTOR_NAMES: Record<string, string> = { gmail: 'Gmail', hubspot: 'HubSpot', notion: 'Notion', slack: 'Slack', webflow: 'Webflow' }

export const FIXTURE_CONNECTOR_SLUGS = Object.keys(FIXTURE_CONNECTOR_NAMES)

export function rewindFixtures(catalog: ConnectorCatalog) {
    const withNames: ConnectorCatalog = new Map(FIXTURE_CONNECTOR_SLUGS.map(slug => [slug, catalog.get(slug) ?? { name: FIXTURE_CONNECTOR_NAMES[slug], icon: null }]))
    return {
        rich: mergeRewind({
            week: FIXTURE_WEEK,
            catalog: withNames,
            agents: [...RICH_AGENTS, { agentId: 'agent-off', engineAgentId: 'engine-off', spaceId: 'space-ops', name: 'Archivist', spaceName: 'Ops', report: null }],
            previous: { runs: 180, workedMs: 30 * HOUR_MS },
            highlights: [
                { agentId: 'agent-quill', headline: 'Shipped 4 SEO articles', detail: 'Published on the blog, each one targeting a keyword with 1k+ monthly searches.' },
                { agentId: 'agent-inbox', headline: 'Triaged 212 emails', detail: 'Labelled every thread and drafted 38 replies waiting for your review.' },
                { agentId: 'agent-scout', headline: 'Found 120 qualified leads', detail: 'Enriched in HubSpot with company size, stack and a warm intro angle.' },
            ],
        }),
        solo: mergeRewind({
            week: FIXTURE_WEEK,
            catalog: withNames,
            agents: [RICH_AGENTS[0]],
            previous: null,
            highlights: [],
        }),
    } satisfies Record<string, RewindPayload>
}

export type RewindFixtures = ReturnType<typeof rewindFixtures>
export type RewindFixtureName = keyof RewindFixtures
