import { describe, expect, it } from 'vitest'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { countSubRuns, currentCall, isSubRunFailing, pairSubRuns, SUB_RUN_FAILURE_STREAK, SUB_RUN_PREVIEW_LENGTH, SUB_RUN_STALLED_AFTER_MS, subRunHeadline, subRunOutcome, subRunTroubleLabel, titledSubRun, type SubRunTask } from './sub-run-progress'

const t = englishTranslator('subRuns')

const delegateTool = (toolCallId: string) => ({ type: 'dynamic-tool', toolName: 'mcp__rerun__delegate_tasks', toolCallId, state: 'input-available' })
const callAgentTool = (toolCallId: string) => ({ type: 'dynamic-tool', toolName: 'mcp__rerun__call_agent', toolCallId, state: 'input-available' })
const delegateData = (id: string, title: string) => ({ type: 'data-delegate', id, data: { tasks: [{ title, status: 'running', steps: 1 }] } })
const callAgentData = (id: string, agentName: string) => ({ type: 'data-call-agent', id, data: { agentName, status: 'running', steps: 1 } })

const titles = (pairing: ReturnType<typeof pairSubRuns>) => Object.fromEntries([...pairing.byToolCallId].map(([toolCallId, progress]) => [toolCallId, progress.tasks[0].title]))

describe('pairSubRuns', () => {
    it('joins on the tool call id when the provider shares it', () => {
        const pairing = pairSubRuns([{ type: 'tool-delegate_tasks', toolCallId: 'call-1' }, delegateData('call-1', 'A')])
        expect(titles(pairing)).toEqual({ 'call-1': 'A' })
        expect(pairing.orphans.size).toBe(0)
    })

    it('pairs by order when a CLI bridge rewrote the id', () => {
        const pairing = pairSubRuns([delegateTool('toolu_01'), delegateData('7', 'A'), delegateTool('toolu_02'), delegateData('9', 'B')])
        expect(titles(pairing)).toEqual({ toolu_01: 'A', toolu_02: 'B' })
        expect(pairing.orphans.size).toBe(0)
    })

    it('keeps each kind on its own tool', () => {
        const pairing = pairSubRuns([callAgentTool('toolu_01'), delegateTool('toolu_02'), callAgentTool('toolu_03'), callAgentData('a', 'Growth'), delegateData('b', 'Research'), callAgentData('c', 'Ops')])
        expect(titles(pairing)).toEqual({ toolu_01: 'Growth', toolu_02: 'Research', toolu_03: 'Ops' })
    })

    it('lets an exact match win before pairing the rest by order', () => {
        const pairing = pairSubRuns([delegateTool('toolu_01'), delegateTool('shared'), delegateData('shared', 'B'), delegateData('7', 'A')])
        expect(titles(pairing)).toEqual({ toolu_01: 'A', shared: 'B' })
    })

    it('reports a part no tool row can take', () => {
        const pairing = pairSubRuns([{ type: 'tool-web_search', toolCallId: 'toolu_01' }, delegateData('7', 'A')])
        expect(pairing.byToolCallId.size).toBe(0)
        expect(pairing.orphans.get('7')?.tasks[0].title).toBe('A')
    })
})

describe('countSubRuns', () => {
    it('counts a stopped task as failed and a failing streak apart from a stall', () => {
        const counts = countSubRuns([
            { title: 'a', status: 'done', steps: 3 },
            { title: 'b', status: 'stopped', steps: 1 },
            { title: 'c', status: 'running', steps: 0, failures: SUB_RUN_FAILURE_STREAK, idleMs: 1_000 },
            { title: 'd', status: 'running', steps: 0, failures: 1, idleMs: SUB_RUN_STALLED_AFTER_MS },
        ])
        expect(counts).toEqual({ total: 4, done: 1, failed: 1, live: 2, stalled: 1, failing: 1 })
        expect(subRunTroubleLabel(counts, t)).toBe(' · 1 stalled · 1 failing')
    })
})

describe('currentCall', () => {
    it('finds the call still open and nothing when every call ended', () => {
        expect(
            currentCall({
                title: 'a',
                status: 'running',
                steps: 0,
                calls: [
                    { tool: 'web_fetch', summary: 'x', durationMs: 10 },
                    { tool: 'shell_exec', summary: 'curl', elapsedMs: 4_000 },
                ],
            })?.tool
        ).toBe('shell_exec')
        expect(currentCall({ title: 'a', status: 'running', steps: 0, calls: [{ tool: 'web_fetch', summary: 'x', durationMs: 10 }] })).toBeUndefined()
        expect(currentCall({ title: 'a', status: 'running', steps: 0 })).toBeUndefined()
    })
})

describe('isSubRunFailing', () => {
    it('flags a running task on a streak of failed calls only', () => {
        expect(isSubRunFailing({ title: 'a', status: 'running', steps: 0, failures: SUB_RUN_FAILURE_STREAK })).toBe(true)
        expect(isSubRunFailing({ title: 'a', status: 'running', steps: 0, failures: SUB_RUN_FAILURE_STREAK - 1 })).toBe(false)
        expect(isSubRunFailing({ title: 'a', status: 'error', steps: 0, failures: 9 })).toBe(false)
    })
})

describe('subRunOutcome', () => {
    it('takes the first sentence of a whole preview', () => {
        expect(subRunOutcome('Capped at 100 µg/day. ANSES wants a warning line.')).toBe('Capped at 100 µg/day.')
    })

    it('skips the cut sentence a truncated preview starts with', () => {
        const tail = 'Four brands sell between 24 and 79 euros. Two are subscription only.'
        const preview = `${'x'.repeat(SUB_RUN_PREVIEW_LENGTH - tail.length - 12)} end of it. ${tail}`.slice(-SUB_RUN_PREVIEW_LENGTH)
        expect(preview).toHaveLength(SUB_RUN_PREVIEW_LENGTH)
        expect(subRunOutcome(preview)).toBe('Four brands sell between 24 and 79 euros.')
    })

    it('keeps a line without punctuation whole', () => {
        expect(subRunOutcome('Found 3 matching invoices')).toBe('Found 3 matching invoices')
    })

    it('drops headings and markdown marks', () => {
        expect(subRunOutcome('## Summary\n\n- **Pricing** lands at 3,10 € a jar. More below.')).toBe('Pricing lands at 3,10 € a jar.')
    })

    it('gives nothing for an empty preview', () => {
        expect(subRunOutcome(undefined)).toBeUndefined()
        expect(subRunOutcome('   ')).toBeUndefined()
    })
})

describe('subRunHeadline', () => {
    const task = (title: string, status: SubRunTask['status'], extra: Partial<SubRunTask> = {}): SubRunTask => ({ title, status, steps: 2, ...extra })

    it('counts a live delegation', () => {
        const tasks = [task('A', 'done', { startedAt: 0, finishedAt: 5_000 }), task('B', 'running'), task('C', 'queued')]
        expect(subRunHeadline({ kind: 'delegate', tasks }, true, 'delegate_tasks', t)).toEqual({ label: 'Delegating · 3 tasks', summary: '1/3 done' })
    })

    it('sums up a settled delegation with its duration', () => {
        const tasks = [task('A', 'done', { startedAt: 0, finishedAt: 482_000 }), task('B', 'done', { startedAt: 0, finishedAt: 60_000 })]
        expect(subRunHeadline({ kind: 'delegate', tasks }, false, 'delegate_tasks', t)).toEqual({ label: '2 tasks done · 8m 02s' })
    })

    it('separates failures from the rest', () => {
        const tasks = [task('A', 'done'), task('B', 'done'), task('C', 'error')]
        expect(subRunHeadline({ kind: 'delegate', tasks }, false, 'delegate_tasks', t)).toEqual({ label: '2 done · 1 failed' })
    })

    it('reports a message handed to a coworker', () => {
        expect(subRunHeadline({ kind: 'call-agent', tasks: [task('Growth', 'dispatched')] }, false, 'call_agent', t)).toEqual({ label: 'Message sent to Growth' })
    })

    it('names the one agent build_team builds', () => {
        expect(subRunHeadline({ kind: 'delegate', tasks: [task('Scout', 'running')] }, true, 'build_team', t)).toEqual({ label: 'Building Scout' })
        expect(subRunHeadline({ kind: 'delegate', tasks: [task('Scout', 'error', { startedAt: 0, finishedAt: 12_000 })] }, false, 'build_team', t)).toEqual({ label: 'Scout could not be built · 12s' })
        expect(subRunHeadline({ kind: 'delegate', tasks: [task('Scout', 'done')] }, false, 'build_team', t)).toEqual({ label: 'Scout built' })
    })

    it('counts a team being built, then points at the board', () => {
        const tasks = [task('Scout', 'done'), task('Writer', 'running', { idleMs: SUB_RUN_STALLED_AFTER_MS })]
        expect(subRunHeadline({ kind: 'delegate', tasks }, true, 'build_team', t)).toEqual({ label: 'Building your team · 2 coworkers', summary: '1/2 done · 1 stalled' })
        expect(subRunHeadline({ kind: 'delegate', tasks: [task('Scout', 'done'), task('Writer', 'done')] }, false, 'build_team', t)).toEqual({ label: '2 coworkers built', summary: 'Open one from the board' })
    })

    it('follows a coworker it called', () => {
        expect(subRunHeadline({ kind: 'call-agent', tasks: [task('Growth', 'running', { toolCalls: 1 })] }, true, 'call_agent', t)).toEqual({ label: 'Calling Growth', summary: '1 call' })
        expect(subRunHeadline({ kind: 'call-agent', tasks: [task('Growth', 'running', { toolCalls: 0 })] }, true, 'call_agent', t)).toEqual({ label: 'Calling Growth', summary: '0 call' })
        expect(subRunHeadline({ kind: 'call-agent', tasks: [task('Growth', 'running')] }, true, 'call_agent', t)).toEqual({ label: 'Calling Growth', summary: 'Step 2' })
        expect(subRunHeadline({ kind: 'call-agent', tasks: [task('Growth', 'done')] }, false, 'call_agent', t)).toEqual({ label: 'Growth answered' })
        expect(subRunHeadline({ kind: 'call-agent', tasks: [task('Growth', 'error')] }, false, 'call_agent', t)).toEqual({ label: 'Growth failed' })
    })
})

describe('titledSubRun', () => {
    it('names the tasks the engine sent without a title', () => {
        const delegate = pairSubRuns([{ type: 'tool-delegate_tasks', toolCallId: 'd' }, { type: 'data-delegate', id: 'd', data: { tasks: [{ title: 'A', status: 'running', steps: 1 }, { status: 'queued', steps: 0 }] } }]).byToolCallId.get('d')!
        expect(titledSubRun(delegate, t).tasks.map(task => task.title)).toEqual(['A', 'Sub-coworker 2'])
        const call = pairSubRuns([{ type: 'tool-call_agent', toolCallId: 'c' }, { type: 'data-call-agent', id: 'c', data: { status: 'running', steps: 1 } }]).byToolCallId.get('c')!
        expect(titledSubRun(call, t).tasks[0].title).toBe('Coworker')
    })

    it('hands back the same progress when every task has a title', () => {
        const progress = { kind: 'delegate' as const, tasks: [{ title: 'A', status: 'running' as const, steps: 1 }] }
        expect(titledSubRun(progress, t)).toBe(progress)
    })
})
