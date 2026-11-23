import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const aborted: string[] = []
vi.mock('../../runtime/run-control.js', () => ({
    abortRun: (runId: string) => {
        aborted.push(runId)
        return true
    },
}))

const { followSubRun, snapshotSubRun, beginSubRun, abortSubRun, registerSubRunStop, unregisterSubRunStop, renderSubRunOutcome, summarizeToolInput, isFailureResult, SUB_RUN_IDLE_TIMEOUT_MS, SUB_RUN_STOPPED_WITH_CALLER, endSubRun } = await import('./sub-run-watch.js')
const { SUB_RUN_STOPPED_BY_USER } = await import('@rerun/contracts')
const { BLOCKED_SOURCE_PREFIX } = await import('../host-breaker.js')
type SubRunProgress = import('./sub-run-watch.js').SubRunProgress

type Part = { type: string; text?: string; toolName?: string; toolCallId?: string; input?: unknown; output?: unknown; error?: unknown }

function scriptedRun(script: (push: (part: Part) => void, end: () => void) => void) {
    const queue: Part[] = []
    let ended = false
    let wake: (() => void) | undefined
    script(
        part => {
            queue.push(part)
            wake?.()
        },
        () => {
            ended = true
            wake?.()
        },
    )
    async function* stream() {
        while (true) {
            if (queue.length) yield queue.shift()!
            else if (ended) return
            else await new Promise<void>(resolve => (wake = resolve))
        }
    }
    return { runId: 'child-run', settled: Promise.resolve({ kind: 'cancelled' as const }), result: { fullStream: stream() } } as unknown as Parameters<typeof followSubRun>[0]
}

const freshProgress = (): SubRunProgress => {
    const progress: SubRunProgress = { status: 'queued', steps: 0, toolCalls: 0, failures: 0, calls: [] }
    beginSubRun(progress)
    return progress
}

const call = (toolCallId: string, toolName: string, input: unknown): Part => ({ type: 'tool-call', toolCallId, toolName, input })
const result = (toolCallId: string, output: unknown): Part => ({ type: 'tool-result', toolCallId, output })

beforeEach(() => {
    aborted.length = 0
    vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('followSubRun', () => {
    it('collects text, steps and the current tool', async () => {
        const progress = freshProgress()
        const onChange = vi.fn()
        const run = scriptedRun((push, end) => {
            push({ type: 'tool-call', toolName: 'web_search' })
            push({ type: 'text-delta', text: 'hello' })
            push({ type: 'finish-step' })
            end()
        })
        await expect(followSubRun(run, progress, { onChange })).resolves.toEqual({ text: 'hello' })
        expect(progress).toMatchObject({ steps: 1, toolCalls: 1, activity: 'web_search', preview: 'hello' })
        expect(onChange).toHaveBeenCalledTimes(3)
        expect(aborted).toEqual([])
    })

    it('times each call, marks the failed ones and keeps the streak', async () => {
        const progress = freshProgress()
        let push!: (part: Part) => void
        let end!: () => void
        const run = scriptedRun((p, e) => {
            push = p
            end = e
        })
        const following = followSubRun(run, progress, { onChange: () => {} })
        push(call('c1', 'mcp__rerun__shell_exec', { command: 'curl -s https://www.reddit.com/r/x.json\n| jq .' }))
        await vi.advanceTimersByTimeAsync(4_000)
        push(result('c1', 'Command failed: exit 22'))
        push(call('c2', 'mcp__rerun__browser_navigate', { url: 'https://www.reddit.com/r/x/' }))
        await vi.advanceTimersByTimeAsync(1_000)
        push({ type: 'tool-error', toolCallId: 'c2', error: 'Navigation failed' })
        push(call('c3', 'web_fetch', { url: 'https://example.com/' }))
        await vi.advanceTimersByTimeAsync(1_000)
        push(result('c3', { type: 'text', value: '[200] https://example.com/\n\nfine' }))
        push(call('c4', 'web_fetch', { url: 'https://example.com/a' }))
        end()
        await following
        expect(progress.toolCalls).toBe(4)
        expect(progress.failures).toBe(0)
        expect(progress.calls.map(c => [c.tool, c.summary, c.failed, c.endedAt === undefined ? 'open' : c.endedAt - c.startedAt])).toEqual([
            ['shell_exec', 'curl -s https://www.reddit.com/r/x.json', true, 4_000],
            ['browser_navigate', 'www.reddit.com/r/x/', true, 1_000],
            ['web_fetch', 'example.com', false, 1_000],
            ['web_fetch', 'example.com/a', undefined, 'open'],
        ])
        expect(progress.activity).toBe('web_fetch')
    })

    it('counts consecutive failures until a call succeeds', async () => {
        const progress = freshProgress()
        const run = scriptedRun((push, end) => {
            push(call('c1', 'web_fetch', { url: 'https://reddit.com/' }))
            push(result('c1', '[403] https://reddit.com/\n\nForbidden'))
            push(call('c2', 'web_fetch', { url: 'https://reddit.com/' }))
            push(result('c2', `${BLOCKED_SOURCE_PREFIX} reddit.com refused 3 consecutive attempts`))
            push(call('c3', 'shell_exec', { command: 'curl https://reddit.com' }))
            push(result('c3', 'Command timed out after 120 s and was killed'))
            end()
        })
        await followSubRun(run, progress, { onChange: () => {} })
        expect(progress.failures).toBe(3)
        const recovered = freshProgress()
        const again = scriptedRun((push, end) => {
            push(call('c1', 'web_fetch', { url: 'https://reddit.com/' }))
            push(result('c1', '[403] https://reddit.com/'))
            push(call('c2', 'web_fetch', { url: 'https://example.com/' }))
            push(result('c2', '[200] https://example.com/\n\nok'))
            end()
        })
        await followSubRun(again, recovered, { onChange: () => {} })
        expect(recovered.failures).toBe(0)
    })

    it('ignores a result whose call it never saw', async () => {
        const progress = freshProgress()
        const onChange = vi.fn()
        const run = scriptedRun((push, end) => {
            push(result('ghost', 'whatever'))
            end()
        })
        await followSubRun(run, progress, { onChange })
        expect(onChange).not.toHaveBeenCalled()
        expect(progress.toolCalls).toBe(0)
    })

    it('keeps only the recent calls', async () => {
        const progress = freshProgress()
        const run = scriptedRun((push, end) => {
            for (let i = 0; i < 12; i++) push(call(`c${i}`, 'web_fetch', { url: `https://example.com/${i}` }))
            end()
        })
        await followSubRun(run, progress, { onChange: () => {} })
        expect(progress.toolCalls).toBe(12)
        expect(progress.calls.map(c => c.summary)).toEqual(['example.com/4', 'example.com/5', 'example.com/6', 'example.com/7', 'example.com/8', 'example.com/9', 'example.com/10', 'example.com/11'])
    })

    it('counts a part it does not report as activity', async () => {
        const progress = freshProgress()
        let push!: (part: Part) => void
        let end!: () => void
        const run = scriptedRun((p, e) => {
            push = p
            end = e
        })
        const following = followSubRun(run, progress, { onChange: () => {} })
        await vi.advanceTimersByTimeAsync(SUB_RUN_IDLE_TIMEOUT_MS - 1000)
        push({ type: 'reasoning-delta', text: 'still thinking' })
        await vi.advanceTimersByTimeAsync(SUB_RUN_IDLE_TIMEOUT_MS - 1000)
        push({ type: 'text-delta', text: 'done' })
        end()
        await expect(following).resolves.toEqual({ text: 'done' })
        expect(aborted).toEqual([])
    })

    it.each(['mcp__rerun__call_agent', 'call_agent', 'delegate_tasks'])('does not count a run waiting on %s as idle, then watches it again', async toolName => {
        let push!: (part: Part) => void
        const run = scriptedRun(p => {
            push = p
        })
        const following = followSubRun(run, freshProgress(), { onChange: () => {} })
        push(call('nested', toolName, { agent: 'Carol' }))
        await vi.advanceTimersByTimeAsync(SUB_RUN_IDLE_TIMEOUT_MS * 3)
        expect(aborted).toEqual([])
        push(result('nested', 'answer'))
        await vi.advanceTimersByTimeAsync(SUB_RUN_IDLE_TIMEOUT_MS)
        await expect(following).resolves.toMatchObject({ stopReason: 'no activity for 15 min, sub-coworker stopped' })
        expect(aborted).toEqual(['child-run'])
    })

    it('still stops a run silent on any other tool', async () => {
        const run = scriptedRun(push => push(call('slow', 'shell_exec', { command: 'sleep 9999' })))
        const following = followSubRun(run, freshProgress(), { onChange: () => {} })
        await vi.advanceTimersByTimeAsync(SUB_RUN_IDLE_TIMEOUT_MS)
        await expect(following).resolves.toMatchObject({ stopReason: 'no activity for 15 min, sub-coworker stopped' })
        expect(aborted).toEqual(['child-run'])
    })

    it('aborts a run that stays silent for the idle timeout and returns what it had said', async () => {
        const run = scriptedRun(push => push({ type: 'text-delta', text: 'so far' }))
        const following = followSubRun(run, freshProgress(), { onChange: () => {} })
        await vi.advanceTimersByTimeAsync(SUB_RUN_IDLE_TIMEOUT_MS)
        await expect(following).resolves.toEqual({ text: 'so far', stopReason: 'no activity for 15 min, sub-coworker stopped' })
        expect(aborted).toEqual(['child-run'])
    })

    it('aborts the run when the calling run is stopped', async () => {
        const parent = new AbortController()
        const run = scriptedRun(() => {})
        const following = followSubRun(run, freshProgress(), { onChange: () => {}, parentSignal: parent.signal })
        parent.abort()
        await expect(following).resolves.toEqual({ text: '', stopReason: 'stopped along with the calling run' })
        expect(aborted).toEqual(['child-run'])
    })

    it('stops one task on demand', async () => {
        const taskSignal = registerSubRunStop('t1')
        const run = scriptedRun(() => {})
        const following = followSubRun(run, freshProgress(), { onChange: () => {}, taskSignal })
        expect(abortSubRun('unknown')).toBe(false)
        expect(abortSubRun('t1')).toBe(true)
        await expect(following).resolves.toEqual({ text: '', stopReason: SUB_RUN_STOPPED_BY_USER })
        expect(aborted).toEqual(['child-run'])
        expect(abortSubRun('t1')).toBe(false)
        unregisterSubRunStop('t1')
    })

    it('reports a run that ended on a stream error without any text', async () => {
        const run = scriptedRun((push, end) => {
            push({ type: 'error', error: new Error('401 unauthorized') })
            end()
        })
        await expect(followSubRun(run, freshProgress(), { onChange: () => {} })).resolves.toEqual({ text: '', stopReason: '401 unauthorized' })
    })
})

describe('endSubRun', () => {
    it('tells a stop from a failure', () => {
        const ended = (reason?: string) => {
            const progress = freshProgress()
            endSubRun(progress, reason)
            return progress.status
        }
        expect(ended()).toBe('done')
        expect(ended(SUB_RUN_STOPPED_BY_USER)).toBe('stopped')
        expect(ended(SUB_RUN_STOPPED_WITH_CALLER)).toBe('stopped')
        expect(ended('401 unauthorized')).toBe('error')
        expect(ended('no activity for 15 min, sub-coworker stopped')).toBe('error')
    })
})

describe('renderSubRunOutcome', () => {
    it('returns the text of a finished run as is', () => {
        expect(renderSubRunOutcome({ text: 'done' }, freshProgress())).toBe('done')
        expect(renderSubRunOutcome({ text: '' }, freshProgress())).toBe('(the sub-coworker returned no text)')
    })

    it('keeps the partial work and the tools tried when the run was stopped', () => {
        const progress = freshProgress()
        progress.calls.push({ tool: 'web_fetch', summary: 'reddit.com/r/x', startedAt: 0, endedAt: 1, failed: true }, { tool: 'web_search', summary: 'tattoo artists no-show', startedAt: 1, endedAt: 2, failed: false })
        expect(renderSubRunOutcome({ text: 'Two threads found.', stopReason: SUB_RUN_STOPPED_BY_USER }, progress)).toBe(
            `(stopped: ${SUB_RUN_STOPPED_BY_USER})\n\nTools tried:\n- web_fetch reddit.com/r/x (failed)\n- web_search tattoo artists no-show\n\nPartial output:\nTwo threads found.`,
        )
        expect(renderSubRunOutcome({ text: '', stopReason: 'x' }, freshProgress())).toBe('(stopped: x)')
    })
})

describe('summarizeToolInput', () => {
    it('picks the field that says what the call does and truncates it', () => {
        expect(summarizeToolInput('shell_exec', { command: `curl -H "Authorization: Bearer abc123" ${'x'.repeat(100)}` })).toBe(`curl -H "Authorization: Bearer *** ${'x'.repeat(100)}`.slice(0, 80))
        expect(summarizeToolInput('fs_read', { path: 'notes/plan.md' })).toBe('notes/plan.md')
        expect(summarizeToolInput('web_search', { query: 'tattoo no-show', maxResults: 5 })).toBe('tattoo no-show')
        expect(summarizeToolInput('memory_recall', 42)).toBe('')
        expect(summarizeToolInput('download', { url: 'not a url' })).toBe('not a url')
        expect(summarizeToolInput('paid_data', { capability: 'tiktok.user.profile', params: { username: 'khaby.lame' } })).toBe('tiktok.user.profile khaby.lame')
    })
})

describe('isFailureResult', () => {
    it('recognises the failure markers of the builtin tools in every result shape', () => {
        expect(isFailureResult('Command failed: exit 1')).toBe(true)
        expect(isFailureResult('[429] https://x')).toBe(true)
        expect(isFailureResult({ content: [{ text: 'Navigation failed: timeout' }] })).toBe(true)
        expect(isFailureResult({ type: 'text', value: `${BLOCKED_SOURCE_PREFIX} x` })).toBe(true)
        expect(isFailureResult('[404] https://x')).toBe(false)
        expect(isFailureResult('[200] https://x\n\nfine')).toBe(false)
        expect(isFailureResult({ type: 'json', value: { ok: true } })).toBe(false)
    })
})

describe('snapshotSubRun', () => {
    it('reports idle time for a running task only', () => {
        const progress = freshProgress()
        vi.advanceTimersByTime(200_000)
        expect(snapshotSubRun(progress).idleMs).toBe(200_000)
        expect(snapshotSubRun(progress)).not.toHaveProperty('lastActivityAt')
        expect(snapshotSubRun({ ...progress, status: 'done' }).idleMs).toBeUndefined()
        expect(snapshotSubRun({ status: 'queued', steps: 0, toolCalls: 0, failures: 0, calls: [] }).idleMs).toBeUndefined()
    })

    it('dates calls relative to now instead of shipping timestamps', () => {
        const progress = freshProgress()
        const now = Date.now()
        progress.calls.push({ tool: 'web_fetch', summary: 'a', startedAt: now - 5_000, endedAt: now - 2_000, failed: false }, { tool: 'shell_exec', summary: 'b', startedAt: now - 3_000 })
        expect(snapshotSubRun(progress).calls).toEqual([
            { tool: 'web_fetch', summary: 'a', failed: false, durationMs: 3_000 },
            { tool: 'shell_exec', summary: 'b', failed: undefined, elapsedMs: 3_000 },
        ])
    })
})
