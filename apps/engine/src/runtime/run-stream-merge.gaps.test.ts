import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk, UIMessageStreamWriter } from 'ai'
import { cutOffWhenSettled, mergeRunStream } from './run-stream-merge.js'
import type { AgentRun, RunOutcome } from './loop.js'

type MetadataFn = (options: { part: any }) => unknown

function fromChunks(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
    return new ReadableStream<UIMessageChunk>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk)
            controller.close()
        },
    })
}

async function drain(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
    const out: UIMessageChunk[] = []
    const reader = stream.getReader()
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        out.push(value)
    }
    return out
}

function fakeRun(chunks: UIMessageChunk[], contextUsage?: AgentRun['contextUsage']) {
    const captured: { messageMetadata?: MetadataFn } = {}
    const run = {
        runId: 'r1',
        settled: Promise.resolve({ kind: 'done' } as RunOutcome),
        contextUsage,
        result: {
            toUIMessageStream: (options: { messageMetadata: MetadataFn }) => {
                captured.messageMetadata = options.messageMetadata
                return fromChunks(chunks)
            },
        },
    } as unknown as AgentRun
    let merged: ReadableStream<UIMessageChunk> | undefined
    const writer = { merge: (stream: ReadableStream<UIMessageChunk>) => (merged = stream), write() {}, onError: undefined } as unknown as UIMessageStreamWriter
    return { run, writer, captured, merged: () => merged! }
}

function pendingSource() {
    const cancel = vi.fn()
    let controller!: ReadableStreamDefaultController<UIMessageChunk>
    const stream = new ReadableStream<UIMessageChunk>({
        start(c) {
            controller = c
        },
        cancel,
    })
    return { stream, cancel, controller: () => controller }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('mergeRunStream', () => {
    // Claude prefixes the bridged tools with mcp__rerun__, Codex with rerun__ on some builds: the
    // dashboard only renders a HITL card for the bare name.
    it('hands the dashboard the bare HITL tool names whatever the CLI prefixed them with', async () => {
        const { run, writer, merged } = fakeRun([
            { type: 'tool-input-start', toolCallId: 'c1', toolName: 'mcp__rerun__ask_user' },
            { type: 'tool-input-available', toolCallId: 'c1', toolName: 'mcp__rerun__ask_user', input: { questions: [] } },
            { type: 'tool-input-start', toolCallId: 'c2', toolName: 'rerun__request_approval' },
            { type: 'tool-input-start', toolCallId: 'c3', toolName: 'mcp__files__read' },
            { type: 'tool-output-available', toolCallId: 'c1', output: { status: 'delivered' } },
        ])

        mergeRunStream(writer, run, { provider: 'claude', model: 'opus' })
        const chunks = (await drain(merged())) as Array<{ toolName?: string }>

        expect(chunks.map(c => c.toolName)).toEqual(['ask_user', 'ask_user', 'request_approval', 'mcp__files__read', undefined])
        expect(chunks[1]).toMatchObject({ toolCallId: 'c1', input: { questions: [] } })
    })

    // An iOS build that shipped before option descriptions would hand an option object to a text
    // node: the v2 stamp makes it fall back to its text card instead.
    it('stamps v2 on an ask_user call whose options carry a description, and only on it', async () => {
        const described = { questions: [{ question: 'Format?', header: 'Format', options: [{ label: 'One-pager', description: 'One page' }, 'Deck'] }] }
        const plain = { questions: [{ question: 'Format?', header: 'Format', options: ['One-pager', 'Deck'] }] }
        const { run, writer, merged } = fakeRun([
            { type: 'tool-input-available', toolCallId: 'c1', toolName: 'mcp__rerun__ask_user', input: described },
            { type: 'tool-input-available', toolCallId: 'c2', toolName: 'ask_user', input: plain },
        ])

        mergeRunStream(writer, run, { provider: 'claude', model: 'opus' })
        const chunks = (await drain(merged())) as Array<{ input?: unknown }>

        expect(chunks[0]).toMatchObject({ toolName: 'ask_user', input: { ...described, v: 2 } })
        expect(chunks[1].input).toEqual(plain)
    })

    it('stamps each finished step with the provider, the model and its usage', () => {
        const { run, writer, captured } = fakeRun([])
        mergeRunStream(writer, run, { provider: 'rerun', model: 'rerun-max' })

        const metadata = captured.messageMetadata!({ part: { type: 'finish-step', usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } } })

        expect(metadata).toEqual({
            provider: 'rerun',
            model: 'rerun-max',
            usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, reasoningTokens: undefined, cachedInputTokens: undefined },
        })
    })

    it('adds the context window occupancy when the run captured one', () => {
        const context = { usedTokens: 42_000, maxTokens: 200_000 }
        const { run, writer, captured } = fakeRun([], () => context as any)
        mergeRunStream(writer, run, { provider: 'claude', model: 'opus' })

        const metadata = captured.messageMetadata!({ part: { type: 'finish-step', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, reasoningTokens: 4, cachedInputTokens: 5 } } }) as { usage: unknown }

        expect(metadata.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3, reasoningTokens: 4, cachedInputTokens: 5, context })
    })

    it('leaves the usage bare when the capture has nothing yet', () => {
        const { run, writer, captured } = fakeRun([], () => undefined)
        mergeRunStream(writer, run, { provider: 'claude', model: 'opus' })

        const metadata = captured.messageMetadata!({ part: { type: 'finish-step', usage: { inputTokens: 1 } } }) as { usage: Record<string, unknown> }

        expect(metadata.usage).not.toHaveProperty('context')
    })

    it('attaches no metadata to any other part', () => {
        const { run, writer, captured } = fakeRun([])
        mergeRunStream(writer, run, { provider: 'rerun', model: 'rerun-max' })

        expect(captured.messageMetadata!({ part: { type: 'text-delta', text: 'hi' } })).toBeUndefined()
        expect(captured.messageMetadata!({ part: { type: 'finish', totalUsage: {} } })).toBeUndefined()
    })
})

describe('cutOffWhenSettled edge cases', () => {
    it('falls back to a generic error text when the failed run carried none', async () => {
        vi.useFakeTimers()
        const source = pendingSource()
        const drained = drain(cutOffWhenSettled(source.stream, Promise.resolve({ kind: 'error' })))

        await vi.advanceTimersByTimeAsync(2_000)

        expect(await drained).toEqual([{ type: 'error', errorText: 'The run failed.' }])
        expect(source.cancel).toHaveBeenCalled()
    })

    it('waits out the grace period before cutting, so the last chunks still land', async () => {
        vi.useFakeTimers()
        const source = pendingSource()
        const drained = drain(cutOffWhenSettled(source.stream, Promise.resolve({ kind: 'cancelled' })))

        await vi.advanceTimersByTimeAsync(1_500)
        source.controller().enqueue({ type: 'text-delta', id: '0', delta: 'late' })
        await vi.advanceTimersByTimeAsync(500)

        expect(await drained).toEqual([{ type: 'text-delta', id: '0', delta: 'late' }])
    })

    it('passes a client disconnect on to the source and never cuts afterwards', async () => {
        vi.useFakeTimers()
        const source = pendingSource()
        const stream = cutOffWhenSettled(source.stream, Promise.resolve({ kind: 'error', error: 'boom' }))
        const reader = stream.getReader()
        await vi.advanceTimersByTimeAsync(100)

        await reader.cancel('client left')

        expect(source.cancel).toHaveBeenCalledWith('client left')
        await expect(vi.advanceTimersByTimeAsync(5_000)).resolves.toBeDefined()
    })

    // Codex fails a turn by erroring its stream rather than with an error part.
    it('hands the chat the run error when the source itself errors', async () => {
        const codexRefusal = `Error: {"detail":"The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account."}`
        const source = pendingSource()
        const drained = drain(cutOffWhenSettled(source.stream, Promise.resolve({ kind: 'error', error: codexRefusal })))

        source.controller().enqueue({ type: 'text-start', id: '0' })
        source.controller().error(new Error('model refused'))

        expect(await drained).toEqual([
            { type: 'text-start', id: '0' },
            { type: 'error', errorText: codexRefusal },
        ])
    })

    it('waits for the run before closing an errored source', async () => {
        const source = pendingSource()
        let settle!: (outcome: RunOutcome) => void
        const drained = drain(cutOffWhenSettled(source.stream, new Promise<RunOutcome>(resolve => (settle = resolve))))
        let ended = false
        void drained.then(() => (ended = true))

        source.controller().error(new Error('model refused'))
        await new Promise(r => setTimeout(r, 20))
        expect(ended).toBe(false)

        settle({ kind: 'error', error: 'model refused' })
        expect(await drained).toEqual([{ type: 'error', errorText: 'model refused' }])
    })

    it('closes an errored source without an error chunk when the run was stopped', async () => {
        const source = pendingSource()
        const drained = drain(cutOffWhenSettled(source.stream, Promise.resolve({ kind: 'cancelled' })))

        source.controller().error(new Error('aborted'))

        expect(await drained).toEqual([])
    })

    it('hands the chat the run error when the turn finished as failed', async () => {
        const drained = drain(cutOffWhenSettled(fromChunks([{ type: 'finish', finishReason: 'length' }]), Promise.resolve({ kind: 'error', error: 'Error: usage_limit_exceeded' })))

        expect(await drained).toEqual([
            { type: 'finish', finishReason: 'length' },
            { type: 'error', errorText: 'Error: usage_limit_exceeded' },
        ])
    })

    it('closes on a clean finish without waiting for the run to settle', async () => {
        const drained = drain(cutOffWhenSettled(fromChunks([{ type: 'finish', finishReason: 'stop' }]), new Promise<RunOutcome>(() => {})))

        expect(await drained).toEqual([{ type: 'finish', finishReason: 'stop' }])
    })
})
