import type { SubRunCall, SubRunTask } from '@moldwright/contracts'
import type { UIMessage } from 'ai'

const BASE_TIME = Date.UTC(2026, 8, 17, 9, 12, 35)
const MINUTE = 60_000

const at = (minutes: number) => BASE_TIME + minutes * MINUTE

type ToolOutcome = { state: 'input-available' } | { state: 'output-available'; output: unknown } | { state: 'output-error'; errorText: string }

export function delegateMessage(id: string, tasks: SubRunTask[], outcome: ToolOutcome = { state: 'input-available' }): UIMessage {
    return {
        id,
        role: 'assistant',
        parts: [
            { type: 'tool-delegate_tasks', toolCallId: id, input: { tasks: tasks.map(t => ({ title: t.title })) }, ...outcome },
            { type: 'data-delegate', id, data: { tasks } },
        ],
    } as UIMessage
}

export function cliDelegateMessage(id: string, tasks: SubRunTask[]): UIMessage {
    return {
        id,
        role: 'assistant',
        parts: [
            { type: 'dynamic-tool', toolName: 'mcp__rerun__delegate_tasks', toolCallId: `toolu_${id}`, state: 'input-available', input: { tasks: tasks.map(t => ({ title: t.title })) } },
            { type: 'data-delegate', id: '7', data: { tasks } },
        ],
    } as UIMessage
}

export function callAgentMessage(id: string, agentName: string, task: Omit<SubRunTask, 'title'>, outcome: ToolOutcome = { state: 'input-available' }): UIMessage {
    return {
        id,
        role: 'assistant',
        parts: [
            { type: 'tool-call_agent', toolCallId: id, input: { agent: agentName }, ...outcome },
            { type: 'data-call-agent', id, data: { agentName, ...task } },
        ],
    } as UIMessage
}

const REGULATION_PREVIEW =
    'EFSA caps vitamin D at 100 µg/day for adults. ANSES flags gummies as a higher overdose risk for children because of the candy format, so the label needs an explicit "keep out of reach" line and a daily dose in pieces, not in grams.'
const COMPETITORS_PREVIEW = 'Gruns: 79 €/month, 28 sachets, green-powder positioning. Nutrops: 24,90 € for 60 gummies, pharmacy channel. Muves: subscription only, 3 SKUs. Juced: bundles from 34 €...'
const PRICING_PREVIEW = 'Contract manufacturers in the EU quote a 5 000 unit MOQ for a custom pectin gummy, 2 500 on a white-label base. Landed cost per jar of 60 sits between 3,10 € and 4,40 €'
const ANGLES_PREVIEW = 'Angle 1, "the one you do not forget": habit framing, morning ritual. Angle 2, "no pills": swallow fatigue among 35+. Angle 3, transparency on dosage versus candy-like competitors.'

export const RUNNING: SubRunTask[] = [
    { id: 't-regulation', title: 'EFSA / ANSES regulation', status: 'done', steps: 9, toolCalls: 14, failures: 0, preview: REGULATION_PREVIEW, startedAt: at(0), finishedAt: at(7) },
    {
        id: 't-competitors',
        title: 'French competitors',
        status: 'running',
        steps: 6,
        toolCalls: 9,
        failures: 0,
        activity: 'web_fetch',
        preview: COMPETITORS_PREVIEW,
        idleMs: 4_000,
        startedAt: at(0),
        calls: [
            { tool: 'web_search', summary: 'gummies beauté France marques', durationMs: 2_100 },
            { tool: 'web_fetch', summary: 'lashile-beauty.com/collections/good-hair', durationMs: 1_400 },
            { tool: 'web_fetch', summary: 'nutrops.fr/produits', elapsedMs: 4_000 },
        ],
    },
    { id: 't-pricing', title: 'Pricing & MOQ', status: 'running', steps: 4, toolCalls: 5, failures: 0, activity: 'web_search', preview: PRICING_PREVIEW, idleMs: 12_000, startedAt: at(0) },
    { id: 't-angles', title: 'Creative angles', status: 'running', steps: 2, toolCalls: 2, failures: 0, preview: ANGLES_PREVIEW, idleMs: 1_000, startedAt: at(0) },
]

export const LOOPING: SubRunTask[] = [
    { ...RUNNING[0] },
    {
        id: 't-reddit',
        title: 'Reddit & forums anglophones',
        status: 'running',
        steps: 0,
        toolCalls: 7,
        failures: 4,
        activity: 'browser_navigate',
        preview: 'Reddit bloque les accès automatiques. J\'essaie en passant par le navigateur.',
        idleMs: 48_000,
        startedAt: at(0),
        calls: [
            { tool: 'web_search', summary: 'reddit tattoo artist no-show deposit', durationMs: 1_900 },
            { tool: 'shell_exec', summary: 'curl -s -A "Mozilla/5.0" https://old.reddit.com/r/TattooArtists/comments/1', failed: true, durationMs: 2_300 },
            { tool: 'shell_exec', summary: 'curl -s https://www.reddit.com/r/TattooArtists.json', failed: true, durationMs: 120_000 },
            { tool: 'web_fetch', summary: 'reddit.com/r/TattooArtists/comments/13d09in', failed: true, durationMs: 800 },
            { tool: 'browser_navigate', summary: 'old.reddit.com/r/TattooArtists/comments/13d09in', failed: true, durationMs: 30_000 },
            { tool: 'browser_navigate', summary: 'reddit.com/r/TattooArtists/comments/vyc338', elapsedMs: 48_000 },
        ],
    },
    { ...RUNNING[1], id: 't-web-fr', title: 'Web francophone', status: 'done', finishedAt: at(6), idleMs: undefined, activity: undefined, calls: undefined },
]

export const STOPPED_ONE: SubRunTask[] = [
    { ...RUNNING[0] },
    {
        id: 't-reddit',
        title: 'Reddit & forums anglophones',
        status: 'stopped',
        steps: 0,
        toolCalls: 7,
        failures: 4,
        error: 'stopped by the user',
        preview: 'Reddit bloque les accès automatiques. J\'essaie en passant par le navigateur.',
        startedAt: at(0),
        finishedAt: at(13),
        calls: LOOPING[1].calls!.map(call => ('elapsedMs' in call ? { tool: call.tool, summary: call.summary, failed: true, durationMs: call.elapsedMs } : call)),
    },
    { ...RUNNING[1], id: 't-web-fr', title: 'Web francophone' },
]

export const STALLED: SubRunTask[] = RUNNING.map(task => (task.title === 'Pricing & MOQ' ? { ...task, idleMs: 7 * MINUTE, calls: [{ tool: 'web_search', summary: 'contract manufacturer pectin gummies EU MOQ', elapsedMs: 7 * MINUTE }] } : task))

export const QUEUED: SubRunTask[] = [
    ...RUNNING.map(task => ({ ...task, status: 'running' as const, finishedAt: undefined })),
    { id: 't-suppliers', title: 'Supplier shortlist', status: 'queued', steps: 0, toolCalls: 0, failures: 0 },
    { id: 't-packaging', title: 'Packaging constraints', status: 'queued', steps: 0, toolCalls: 0, failures: 0 },
]

export const ALL_DONE: SubRunTask[] = RUNNING.map((task, i) => ({ ...task, status: 'done', activity: undefined, idleMs: undefined, calls: undefined, steps: 9 + i * 2, toolCalls: 14 + i * 3, finishedAt: at(8 + i * 2) + 2_000 }))

export const ONE_CUT: SubRunTask[] = ALL_DONE.map(task =>
    task.title === 'Pricing & MOQ' ? { ...task, status: 'error', steps: 4, error: 'no activity for 15 min, sub-coworker stopped', finishedAt: at(19) } : task,
)

export const ALL_FAILED: SubRunTask[] = ALL_DONE.slice(0, 2).map(task => ({ ...task, status: 'error', preview: undefined, error: 'Insufficient credits to start a sub-agent', finishedAt: at(0) + 3_000 }))

type ScriptCall = { tool: string; summary: string; at: number; duration: number; failed?: boolean }
type ScriptTask = { id: string; title: string; calls: ScriptCall[]; doneAt: number; preview: string }

const SCRIPT: ScriptTask[] = [
    {
        id: 'live-regulation',
        title: 'EFSA / ANSES regulation',
        calls: [
            { tool: 'web_search', summary: 'vitamin D gummies EFSA upper limit', at: 300, duration: 1_200 },
            { tool: 'web_fetch', summary: 'efsa.europa.eu/en/efsajournal/pub/7204', at: 1_600, duration: 1_900 },
            { tool: 'web_fetch', summary: 'anses.fr/fr/content/vitamine-d', at: 3_600, duration: 2_100 },
        ],
        doneAt: 6_100,
        preview: 'Capped at 100 µg/day for adults. ANSES wants a "keep out of reach" line and a daily dose in pieces, not in grams.',
    },
    {
        id: 'live-competitors',
        title: 'French competitors',
        calls: [
            { tool: 'web_search', summary: 'gummies vitamine D marques France', at: 400, duration: 1_400 },
            { tool: 'web_fetch', summary: 'nutrops.fr/produits', at: 1_900, duration: 1_100, failed: true },
            { tool: 'web_fetch', summary: 'nutrops.fr/produits', at: 3_400, duration: 1_500 },
            { tool: 'browser_navigate', summary: 'gruns.co/products/daily', at: 5_000, duration: 2_600 },
        ],
        doneAt: 8_100,
        preview: '4 brands from 24,90 € to 79 € a month. Gruns and Muves sell on subscription only, Nutrops goes through pharmacies.',
    },
    {
        id: 'live-pricing',
        title: 'Pricing & MOQ',
        calls: [
            { tool: 'web_search', summary: 'contract manufacturer pectin gummies EU MOQ', at: 500, duration: 1_500 },
            { tool: 'web_fetch', summary: 'eu-gummy-makers.com/moq', at: 2_100, duration: 2_000 },
            { tool: 'shell_exec', summary: 'python landed_cost.py --units 5000', at: 4_200, duration: 2_100 },
        ],
        doneAt: 6_800,
        preview: '5 000 units minimum, 3,10 € to 4,40 € landed per jar of 60. White label drops the minimum to 2 500.',
    },
]

const LIVE_STARTED_AT = at(0)
const LIVE_TOOL_DONE_AT = Math.max(...SCRIPT.map(task => task.doneAt)) + 300
export const LIVE_END_AT = LIVE_TOOL_DONE_AT + 3_000

function trailingFailures(calls: SubRunCall[]): number {
    let streak = 0
    for (const call of [...calls].reverse()) {
        if (call.elapsedMs !== undefined) continue
        if (!call.failed) break
        streak++
    }
    return streak
}

function taskAt(task: ScriptTask, elapsed: number): SubRunTask {
    const done = elapsed >= task.doneAt
    const calls: SubRunCall[] = task.calls
        .filter(call => call.at <= elapsed)
        .map(call =>
            elapsed >= call.at + call.duration ? { tool: call.tool, summary: call.summary, failed: call.failed, durationMs: call.duration } : { tool: call.tool, summary: call.summary, elapsedMs: elapsed - call.at },
        )
    const lastEnd = Math.max(0, ...task.calls.filter(call => call.at + call.duration <= elapsed).map(call => call.at + call.duration))
    return {
        id: task.id,
        title: task.title,
        status: done ? 'done' : 'running',
        steps: calls.filter(call => call.durationMs !== undefined).length,
        toolCalls: calls.length,
        failures: trailingFailures(calls),
        calls,
        activity: calls.at(-1)?.tool,
        preview: done ? task.preview : undefined,
        idleMs: done ? undefined : elapsed - lastEnd,
        startedAt: LIVE_STARTED_AT,
        finishedAt: done ? LIVE_STARTED_AT + task.doneAt : undefined,
    }
}

export const liveTasksAt = (elapsed: number): SubRunTask[] => SCRIPT.map(task => taskAt(task, elapsed))
