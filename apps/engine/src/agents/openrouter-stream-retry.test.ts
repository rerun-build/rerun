import { APICallError } from 'ai'
import { describe, expect, it } from 'vitest'
import { STREAM_CUT_RAW_REASON } from '../runtime/provider-errors.js'
import { createStreamRetryMiddleware } from './openrouter-stream-retry.js'

const noUsage = {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}
const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
}

const streamStart = { type: 'stream-start', warnings: [] }
const thought = [
    { type: 'reasoning-start', id: 'reasoning-0' },
    { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Let me think' },
]
const emptyText = [
    { type: 'text-start', id: '0' },
    { type: 'text-delta', id: '0', delta: '' },
]
const cutFinish = { type: 'finish', finishReason: { unified: 'other', raw: undefined }, usage: noUsage }
const realFinish = { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }
const answer = [streamStart, { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'done' }, { type: 'text-end', id: '0' }, realFinish]

type Attempt = unknown[] | { throws: unknown } | { breaksAfter: unknown[] }

function streamOf(attempt: Exclude<Attempt, { throws: unknown }>): ReadableStream {
    const parts = Array.isArray(attempt) ? attempt : attempt.breaksAfter
    let next = 0
    return new ReadableStream({
        pull(controller) {
            if (next < parts.length) controller.enqueue(parts[next++])
            else if (Array.isArray(attempt)) controller.close()
            else controller.error(new TypeError('terminated'))
        },
    })
}

async function run(attempts: Attempt[], abortSignal?: AbortSignal) {
    let calls = 0
    const doStream = async () => {
        const attempt = attempts[calls++]
        if (!attempt) throw new Error('no attempt left')
        if (!Array.isArray(attempt) && 'throws' in attempt) throw attempt.throws
        return { stream: streamOf(attempt) }
    }
    const result = await createStreamRetryMiddleware([0, 0]).wrapStream!({ doStream, params: { abortSignal } } as any)
    const parts: any[] = []
    for await (const part of result.stream as ReadableStream<any>) parts.push(part)
    return { parts, calls }
}

const finishOf = (parts: any[]) => parts.filter(p => p.type === 'finish')

describe('OpenRouter stream retry', () => {
    it('passes a stream that finished on its own through untouched', async () => {
        const { parts, calls } = await run([answer])

        expect(calls).toBe(1)
        expect(parts).toEqual(answer)
    })

    it('replays a step cut while it was still reasoning', async () => {
        const { parts, calls } = await run([[streamStart, ...thought, ...emptyText, { type: 'text-end', id: '0' }, { type: 'reasoning-end', id: 'reasoning-0' }, cutFinish], answer])

        expect(calls).toBe(2)
        expect(parts.filter(p => p.type === 'stream-start')).toHaveLength(1)
        expect(finishOf(parts)).toEqual([realFinish])
        expect(parts.filter(p => p.type === 'text-delta').map(p => p.delta).join('')).toBe('done')
    })

    it('closes the blocks a broken socket left open before replaying', async () => {
        const { parts, calls } = await run([{ breaksAfter: [streamStart, ...thought, ...emptyText] }, answer])

        expect(calls).toBe(2)
        const replayStart = parts.map(p => p.type).lastIndexOf('text-start')
        expect(parts.slice(0, replayStart).map(p => p.type)).toEqual(['stream-start', 'reasoning-start', 'reasoning-delta', 'text-start', 'text-delta', 'text-end', 'reasoning-end'])
        expect(finishOf(parts)).toEqual([realFinish])
    })

    it('fails the step instead of replaying once the answer has started', async () => {
        const { parts, calls } = await run([[streamStart, { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'Here is' }, { type: 'text-end', id: '0' }, cutFinish], answer])

        expect(calls).toBe(1)
        expect(finishOf(parts)).toEqual([{ type: 'finish', usage: noUsage, finishReason: { unified: 'error', raw: STREAM_CUT_RAW_REASON } }])
    })

    it('fails the step instead of replaying once a tool call has started', async () => {
        const { parts, calls } = await run([{ breaksAfter: [streamStart, { type: 'tool-input-start', id: 'call-1', toolName: 'bash' }] }, answer])

        expect(calls).toBe(1)
        expect(finishOf(parts)[0].finishReason.raw).toBe(STREAM_CUT_RAW_REASON)
    })

    it('gives up after two replays', async () => {
        const cut = [streamStart, ...thought, { type: 'reasoning-end', id: 'reasoning-0' }, cutFinish]
        const { parts, calls } = await run([cut, cut, cut, answer])

        expect(calls).toBe(3)
        expect(finishOf(parts)).toHaveLength(1)
        expect(finishOf(parts)[0].finishReason.raw).toBe(STREAM_CUT_RAW_REASON)
    })

    it('keeps replaying through a hub that is still booting', async () => {
        const booting = new APICallError({ message: 'Bad Gateway', url: 'https://hub.test', requestBodyValues: {}, statusCode: 502, isRetryable: true })
        const { parts, calls } = await run([[streamStart, cutFinish], { throws: booting }, answer])

        expect(calls).toBe(3)
        expect(finishOf(parts)).toEqual([realFinish])
    })

    it('surfaces an error the replay cannot get past', async () => {
        const spent = new APICallError({ message: 'Payment Required', url: 'https://hub.test', requestBodyValues: {}, statusCode: 402, isRetryable: false })
        const { parts, calls } = await run([[streamStart, cutFinish], { throws: spent }])

        expect(calls).toBe(2)
        expect(parts.at(-1)).toEqual({ type: 'error', error: spent })
    })

    it('never replays a run that was stopped', async () => {
        const controller = new AbortController()
        controller.abort()
        const { parts, calls } = await run([[streamStart, cutFinish], answer], controller.signal)

        expect(calls).toBe(1)
        expect(finishOf(parts)[0].finishReason.raw).toBe(STREAM_CUT_RAW_REASON)
    })
})
