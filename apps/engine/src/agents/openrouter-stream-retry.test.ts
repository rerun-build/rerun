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
// What `@ai-sdk/openai` emits when the server hangs up on it: its flush closes the text block and
// makes up a finish of its own.
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

    describe('a cut the provider announced with an error', () => {
        const upstream500 = { type: 'error', error: { message: 'Streaming response failed: [500] Internal server error', type: 'server_error' } }
        // What `@ai-sdk/openai` makes of an error chunk: the error, then a finish with no raw reason.
        const errorFinish = { type: 'finish', finishReason: { unified: 'error', raw: undefined }, usage: noUsage }
        const failed = [streamStart, ...thought, { type: 'reasoning-end', id: 'reasoning-0' }, upstream500, errorFinish]
        const errorsOf = (parts: any[]) => parts.filter(p => p.type === 'error')

        it('keeps it from the run when the replay goes through', async () => {
            const { parts, calls } = await run([failed, answer])

            expect(calls).toBe(2)
            expect(errorsOf(parts)).toEqual([])
            expect(finishOf(parts)).toEqual([realFinish])
        })

        it('hands it over once, right before the failed finish, when it gives up', async () => {
            const { parts, calls } = await run([failed, failed, failed, answer])

            expect(calls).toBe(3)
            expect(parts.at(-2)).toEqual(upstream500)
            expect(errorsOf(parts)).toHaveLength(1)
            expect(finishOf(parts)).toEqual([parts.at(-1)])
            expect(parts.at(-1).finishReason.raw).toBe(STREAM_CUT_RAW_REASON)
        })

        it('keeps the reason when the replays end without one', async () => {
            const { parts } = await run([failed, [streamStart, cutFinish], [streamStart, cutFinish]])

            expect(errorsOf(parts)).toEqual([upstream500])
        })

        it('hands it over at once when the answer has started', async () => {
            const { parts, calls } = await run([[streamStart, { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'Here is' }, upstream500, { type: 'text-end', id: '0' }, errorFinish], answer])

            expect(calls).toBe(1)
            expect(parts.map(p => p.type)).toEqual(['stream-start', 'text-start', 'text-delta', 'error', 'text-end', 'finish'])
        })

        it.each([
            ['no credit left', { message: 'Insufficient credits', code: 402 }],
            ['a request turned down', { message: 'Provider returned error', code: 400 }],
            ['a rejected key', { message: 'Unauthorized', code: 'invalid_api_key' }],
            ['a spent plan', { message: "You've hit your usage limit", code: 429 }],
        ])('never replays %s', async (_, error) => {
            const refusal = { type: 'error', error }
            const { parts, calls } = await run([[streamStart, refusal, errorFinish], answer])

            expect(calls).toBe(1)
            expect(errorsOf(parts)).toEqual([refusal])
            expect(finishOf(parts)).toHaveLength(1)
        })

        it.each([429, '429', 502, 'server_error'])('replays an upstream that says %s', async code => {
            const { parts, calls } = await run([[streamStart, { type: 'error', error: { message: 'Try again', code } }, errorFinish], answer])

            expect(calls).toBe(2)
            expect(errorsOf(parts)).toEqual([])
        })

        it('hands it over before a finish the provider wrote itself', async () => {
            const { parts, calls } = await run([[streamStart, upstream500, realFinish], answer])

            expect(calls).toBe(1)
            expect(parts).toEqual([streamStart, upstream500, realFinish])
        })

        it('hands it over when the stream then goes on', async () => {
            const { parts, calls } = await run([[streamStart, upstream500, ...answer.slice(1)], answer])

            expect(calls).toBe(1)
            expect(errorsOf(parts)).toEqual([upstream500])
            expect(parts.findIndex(p => p.type === 'error')).toBeLessThan(parts.findIndex(p => p.type === 'text-delta'))
        })

        it('hands it over when the stream just ends', async () => {
            const { parts } = await run([[streamStart, upstream500], answer])

            expect(parts).toEqual([streamStart, upstream500])
        })

        it('drops it when the run was stopped', async () => {
            const controller = new AbortController()
            controller.abort()
            const { parts, calls } = await run([failed, answer], controller.signal)

            expect(calls).toBe(1)
            expect(errorsOf(parts)).toEqual([])
        })

        it('lets the refusal of the replay speak for the step', async () => {
            const refusal = { type: 'error', error: { message: 'Insufficient credits', code: 402 } }
            const { parts, calls } = await run([failed, [streamStart, refusal, errorFinish], answer])

            expect(calls).toBe(2)
            expect(errorsOf(parts)).toEqual([refusal])
        })

        it('lets the error of a replay that had started answering speak for the step', async () => {
            const upstream502 = { type: 'error', error: { message: 'Bad gateway', code: 502 } }
            const { parts, calls } = await run([failed, [streamStart, { type: 'text-start', id: '0' }, { type: 'text-delta', id: '0', delta: 'Here is' }, upstream502, errorFinish], answer])

            expect(calls).toBe(2)
            expect(errorsOf(parts)).toEqual([upstream502])
        })

        it.each([
            ['the first of two', { message: 'Bad gateway', code: 502 }, 'first'],
            ['the one that will not go away', { message: 'Insufficient credits', code: 402 }, 'second'],
        ])('hands over %s', async (_, error, kept) => {
            const second = { type: 'error', error }
            const { parts } = await run([[streamStart, upstream500, second, realFinish]])

            expect(errorsOf(parts)).toEqual([kept === 'first' ? upstream500 : second])
        })

        it('drops it when the replay is refused for good', async () => {
            const spent = new APICallError({ message: 'Payment Required', url: 'https://hub.test', requestBodyValues: {}, statusCode: 402, isRetryable: false })
            const { parts } = await run([failed, { throws: spent }])

            expect(errorsOf(parts)).toEqual([{ type: 'error', error: spent }])
        })
    })

    it('never replays a run that was stopped', async () => {
        const controller = new AbortController()
        controller.abort()
        const { parts, calls } = await run([[streamStart, cutFinish], answer], controller.signal)

        expect(calls).toBe(1)
        expect(finishOf(parts)[0].finishReason.raw).toBe(STREAM_CUT_RAW_REASON)
    })
})
