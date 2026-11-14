import { setTimeout as sleep } from 'node:timers/promises'
import { APICallError, type LanguageModelMiddleware } from 'ai'
import { STREAM_CUT_RAW_REASON } from '../runtime/provider-errors.js'

type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type StreamResult = Awaited<ReturnType<Parameters<WrapStream>[0]['doStream']>>
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never
type FinishPart = Extract<StreamPart, { type: 'finish' }>

const RETRY_DELAYS_MS = [2_000, 8_000]

type AttemptEnd = { kind: 'finished' } | { kind: 'cut'; finish?: FinishPart } | { kind: 'aborted'; error: unknown }

function isCutFinish(part: StreamPart): part is FinishPart {
    return part.type === 'finish' && part.finishReason.raw === undefined && part.usage.inputTokens.total === undefined
}

function commitsTheStep(part: StreamPart): boolean {
    if (part.type === 'text-delta') return part.delta.length > 0
    return part.type === 'tool-input-start' || part.type === 'tool-call' || part.type === 'tool-result' || part.type === 'file' || part.type === 'source'
}

function isRetryableOpenError(error: unknown): boolean {
    return !APICallError.isInstance(error) || error.isRetryable
}

function cutFinish(finish: FinishPart | undefined): FinishPart {
    const usage = finish?.usage ?? {
        inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    }
    return { ...finish, type: 'finish', usage, finishReason: { unified: 'error', raw: STREAM_CUT_RAW_REASON } }
}

export function createStreamRetryMiddleware(retryDelaysMs: readonly number[] = RETRY_DELAYS_MS): LanguageModelMiddleware {
    return {
        specificationVersion: 'v3',
        wrapStream: async ({ doStream, params }) => {
            const first = await doStream()
            const signal = params.abortSignal
            let reader: ReadableStreamDefaultReader<StreamPart> | undefined
            let cancelled = false

            const stream = new ReadableStream<StreamPart>({
                start(controller) {
                    const openBlocks = new Map<string, 'text-end' | 'reasoning-end'>()
                    let committed = false

                    const forward = async (attempt: ReadableStream<StreamPart>, isReplay: boolean): Promise<AttemptEnd> => {
                        const current = attempt.getReader()
                        reader = current
                        try {
                            for (;;) {
                                const { done, value } = await current.read()
                                if (done) return { kind: 'finished' }
                                if (isCutFinish(value)) return { kind: 'cut', finish: value }
                                if (isReplay && value.type === 'stream-start') continue
                                if (value.type === 'text-start') openBlocks.set(`text:${value.id}`, 'text-end')
                                if (value.type === 'reasoning-start') openBlocks.set(`reasoning:${value.id}`, 'reasoning-end')
                                if (value.type === 'text-end') openBlocks.delete(`text:${value.id}`)
                                if (value.type === 'reasoning-end') openBlocks.delete(`reasoning:${value.id}`)
                                committed ||= commitsTheStep(value)
                                controller.enqueue(value)
                            }
                        } catch (error) {
                            return signal?.aborted ? { kind: 'aborted', error } : { kind: 'cut' }
                        } finally {
                            current.releaseLock()
                            reader = undefined
                        }
                    }

                    const closeOpenBlocks = () => {
                        for (const [key, type] of [...openBlocks].reverse()) controller.enqueue({ type, id: key.slice(key.indexOf(':') + 1) } as StreamPart)
                        openBlocks.clear()
                    }

                    const run = async () => {
                        let attempt: ReadableStream<StreamPart> | undefined = first.stream
                        let lastFinish: FinishPart | undefined
                        for (let retries = 0; ; retries++) {
                            if (attempt) {
                                const end = await forward(attempt, retries > 0)
                                if (end.kind === 'finished') return controller.close()
                                if (end.kind === 'aborted') return controller.error(end.error)
                                lastFinish = end.finish ?? lastFinish
                            }
                            if (committed || retries >= retryDelaysMs.length || signal?.aborted) {
                                closeOpenBlocks()
                                controller.enqueue(cutFinish(lastFinish))
                                return controller.close()
                            }
                            closeOpenBlocks()
                            await sleep(retryDelaysMs[retries], undefined, { signal }).catch(() => {})
                            if (cancelled) return
                            if (signal?.aborted) {
                                attempt = undefined
                                continue
                            }
                            try {
                                attempt = (await doStream()).stream
                            } catch (error) {
                                if (!isRetryableOpenError(error)) {
                                    controller.enqueue({ type: 'error', error } as StreamPart)
                                    return controller.close()
                                }
                                attempt = undefined
                            }
                        }
                    }

                    run().catch(error => {
                        if (!cancelled) controller.error(error)
                    })
                },
                cancel(reason) {
                    cancelled = true
                    return reader?.cancel(reason)
                },
            })

            return { ...first, stream }
        },
    }
}

export const openrouterStreamRetryMiddleware = createStreamRetryMiddleware()
