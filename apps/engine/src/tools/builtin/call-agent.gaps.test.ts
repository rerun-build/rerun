import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-callagent-gaps-'))
process.env.RERUN_API_KEY = ''

const { beforeEach, describe, expect, it, vi } = await import('vitest')

type Part = { type: string; text?: string; error?: unknown; toolName?: string; toolCallId?: string; input?: unknown; output?: unknown }
type Target = { id: string; config: { name: string; enabled: boolean; tools: { callAgent: boolean }; selfImprovement: { enabled: boolean } } }

const state = vi.hoisted(() => ({
    notifications: [] as Record<string, unknown>[],
    runs: [] as { callee: Target; sessionId: string; prompt: string }[],
    startError: null as Error | null,
    stream: (async function* () {})() as AsyncIterable<unknown>,
    target: null as unknown as Target,
}))

vi.mock('../../runtime/notify.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../../runtime/notify.js')>()),
    sendNotification: async (input: Record<string, unknown>) => {
        state.notifications.push(input)
        return { delivered: true }
    },
}))

vi.mock('../../runtime/headless-run.js', () => ({
    startHeadlessRun: async (callee: Target, sessionId: string, prompt: string) => {
        state.runs.push({ callee, sessionId, prompt })
        if (state.startError) throw state.startError
        return { runId: 'run-callee', settled: Promise.resolve(), result: { fullStream: state.stream } }
    },
}))

vi.mock('../../agents/registry.js', () => ({ getAgent: async () => state.target }))

const { callAgentTools } = await import('./call-agent.js')
const { getSession } = await import('../../db/repos/sessions.js')

const targets = [{ id: 'agent-bob', name: 'Bob' }] as any

type Written = { type: string; id?: string; data: { agentName: string; status: string; error?: string; sessionId?: string; preview?: string } }

function streamOf(parts: Part[], thenThrow?: Error): AsyncIterable<unknown> {
    return (async function* () {
        for (const part of parts) yield part
        if (thenThrow) throw thenThrow
    })()
}

function hangingStream(): AsyncIterable<unknown> {
    return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<unknown>>(() => {}) }) }
}

async function callBob(args: { message?: string; context?: string; wait?: boolean }, abortSignal?: AbortSignal) {
    const written: Written[] = []
    const ctx = { agent: { id: 'agent-alice', config: { name: 'Alice' } }, sessionId: 'session-alice', callTargets: targets, writer: { write: (part: Written) => written.push(part) }, abortSignal }
    const answer = (await (callAgentTools(ctx as any).call_agent as any).execute({ agent: 'Bob', message: args.message ?? 'Summarize the week', context: args.context, wait: args.wait ?? true }, { toolCallId: 'tc-1' })) as string
    return { answer, written }
}

beforeEach(() => {
    state.notifications = []
    state.runs = []
    state.startError = null
    state.stream = streamOf([])
    state.target = { id: 'agent-bob', config: { name: 'Bob', enabled: true, tools: { callAgent: true }, selfImprovement: { enabled: true } } }
})

describe('call_agent', () => {
    it('refuses to call an agent that is switched off, before opening a session', async () => {
        state.target.config.enabled = false
        const { answer, written } = await callBob({})
        expect(answer).toBe('Coworker "Bob" is switched off and cannot be called.')
        expect(state.runs).toEqual([])
        expect(state.notifications).toEqual([])
        expect(written.at(-1)?.data).toMatchObject({ status: 'error', error: answer })
    })

    it('lets the callee call coworkers but not self-improve, leaving its own config alone', async () => {
        await callBob({ wait: false })
        expect(state.runs[0].callee.config.tools.callAgent).toBe(true)
        expect(state.runs[0].callee.config.selfImprovement.enabled).toBe(false)
        expect(state.target.config.tools.callAgent).toBe(true)
        expect(state.target.config.selfImprovement.enabled).toBe(true)
    })

    it('leaves the callee without call_agent when its own settings turn it off', async () => {
        state.target.config.tools.callAgent = false
        await callBob({ wait: false })
        expect(state.runs[0].callee.config.tools.callAgent).toBe(false)
    })

    it('puts the context above the message', async () => {
        await callBob({ message: 'Draft the reply', context: 'The client is angry', wait: false })
        expect(state.runs[0].prompt).toBe('The client is angry\n\n---\n\nDraft the reply')
    })

    it('opens an agent-sourced session that records who called', async () => {
        await callBob({ message: 'x'.repeat(200), wait: false })
        const session = await getSession('agent-bob', state.runs[0].sessionId)
        expect(session).toMatchObject({ title: `from Alice: ${'x'.repeat(80)}`, source: 'agent', originAgentId: 'agent-alice', originSessionId: 'session-alice' })
    })

    it('closes the mirrored session with an error when the run cannot start', async () => {
        state.startError = new Error('provider not configured')
        const { answer, written } = await callBob({})
        expect(answer).toBe('(error calling Bob: provider not configured)')
        expect(state.notifications.map(n => n.event)).toEqual(['agent.session.created', 'agent.message.completed'])
        expect(state.notifications[1]).toMatchObject({
            kind: 'error',
            agentId: 'agent-bob',
            sessionId: state.runs[0].sessionId,
            message: 'Message failed: provider not configured',
            metadata: { source: 'agent', status: 'error', error: 'provider not configured' },
        })
        expect(written.at(-1)?.data).toMatchObject({ status: 'error', error: 'provider not configured' })
    })

    it('stringifies a non-Error start failure', async () => {
        state.startError = 'quota' as unknown as Error
        expect((await callBob({})).answer).toBe('(error calling Bob: quota)')
    })
})

describe('call_agent with wait', () => {
    it('returns the answer and reports progress as it streams', async () => {
        state.stream = streamOf([
            { type: 'text-delta', text: 'Revenue ' },
            { type: 'text-delta', text: 'is up.' },
            { type: 'finish-step' },
        ])
        const { answer, written } = await callBob({})
        expect(answer).toBe('Revenue is up.')
        expect(written.map(w => w.data.preview).filter(Boolean)).toContain('Revenue is up.')
        expect(written.at(-1)?.data).toMatchObject({ agentName: 'Bob', status: 'done' })
        expect(written.at(-1)?.data.sessionId).toBe(state.runs[0].sessionId)
    })

    it('says so when the callee answers with no text', async () => {
        expect((await callBob({})).answer).toBe('(the coworker returned no text)')
    })

    it('reports a stream error when the callee said nothing', async () => {
        state.stream = streamOf([{ type: 'error', error: new Error('rate limited') }])
        const { answer, written } = await callBob({})
        expect(answer).toBe('(error calling Bob: (stopped: rate limited))')
        expect(written.at(-1)?.data).toMatchObject({ status: 'error', error: 'rate limited' })
    })

    it('reports a stream that throws mid-way', async () => {
        state.stream = streamOf([{ type: 'text-delta', text: 'partial' }], new Error('socket hang up'))
        const { answer, written } = await callBob({})
        expect(answer).toBe('(error calling Bob: socket hang up)')
        expect(written.at(-1)?.data).toMatchObject({ status: 'error', error: 'socket hang up' })
    })

    it('stops following the callee when the calling run is stopped', async () => {
        state.stream = hangingStream()
        const controller = new AbortController()
        const pending = callBob({}, controller.signal)
        await new Promise(resolve => setTimeout(resolve, 10))
        controller.abort()
        const { answer, written } = await pending
        expect(answer).toBe('(error calling Bob: (stopped: stopped along with the calling run))')
        expect(written.at(-1)?.data).toMatchObject({ status: 'stopped' })
    })
})
