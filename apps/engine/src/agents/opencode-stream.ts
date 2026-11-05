import type { LanguageModelMiddleware } from 'ai'
import { REASONING_ID, chunkReasoningDelta, closesReasoning } from './openrouter-reasoning.js'

type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type StreamResult = Awaited<ReturnType<Parameters<WrapStream>[0]['doStream']>>
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never
type FinishPart = Extract<StreamPart, { type: 'finish' }>

// What OpenCode adds to the usage of every answer, on all four wire formats. `list_cost` is in USD
// and is what the call is worth at list price, whoever pays it: on Go the plan does.
export type OpencodeUsage = {
    billing_source?: unknown
    list_cost?: unknown
    tokens?: { cache_read?: unknown; cache_write_5m?: unknown; cache_write_1h?: unknown } | null
}

export type OpencodeCost = { billingSource: string; cost: number }

const SEARCH_DEPTH = 4

// Each format nests its usage somewhere else (`usage`, `message.usage`, `response.usage`,
// `usageMetadata`), so the raw chunk is searched rather than walked by a path per format.
export function findOpencodeUsage(value: unknown, depth = 0): OpencodeUsage | undefined {
    if (!value || typeof value !== 'object' || depth > SEARCH_DEPTH) return undefined
    const own = (value as { opencode?: unknown }).opencode
    if (own && typeof own === 'object' && 'billing_source' in own) return own as OpencodeUsage
    for (const child of Object.values(value as Record<string, unknown>)) {
        const found = findOpencodeUsage(child, depth + 1)
        if (found) return found
    }
    return undefined
}

const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

// The cost Rerun records is the real one: nothing on top of the Go plan, the list price on Console.
export function opencodeCost(usage: OpencodeUsage): OpencodeCost | undefined {
    if (typeof usage.billing_source !== 'string') return undefined
    if (usage.billing_source === 'go') return { billingSource: 'go', cost: 0 }
    const cost = asNumber(usage.list_cost)
    return cost === undefined ? undefined : { billingSource: usage.billing_source, cost }
}

function cacheWriteOf(usage: OpencodeUsage): number | undefined {
    const short = asNumber(usage.tokens?.cache_write_5m)
    const long = asNumber(usage.tokens?.cache_write_1h)
    return short === undefined && long === undefined ? undefined : (short ?? 0) + (long ?? 0)
}

function withOpencodeUsage(part: FinishPart, usage: OpencodeUsage): FinishPart {
    const cost = opencodeCost(usage)
    const cacheWrite = cacheWriteOf(usage)
    const { inputTokens } = part.usage
    return {
        ...part,
        usage: cacheWrite !== undefined && !inputTokens.cacheWrite ? { ...part.usage, inputTokens: { ...inputTokens, cacheWrite } } : part.usage,
        providerMetadata: cost ? { ...part.providerMetadata, opencode: cost } : part.providerMetadata,
    }
}

/**
 * Reads what OpenCode says a step cost off the raw chunks and grafts it on the finish part, where
 * `costMicrosFrom` in the run loop and the step telemetry read it. Stream only: the one-shot calls
 * (compaction, curator, vision) record no cost of their own.
 */
export const opencodeUsageMiddleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({ ...params, includeRawChunks: true }),
    wrapStream: async ({ doStream }) => {
        const result = await doStream()
        let usage: OpencodeUsage | undefined
        return {
            ...result,
            stream: result.stream.pipeThrough(
                new TransformStream<StreamPart, StreamPart>({
                    transform(part, controller) {
                        if (part.type === 'raw') usage = findOpencodeUsage(part.rawValue) ?? usage
                        controller.enqueue(part.type === 'finish' && usage ? withOpencodeUsage(part, usage) : part)
                    },
                }),
            ),
        }
    },
}

/**
 * The chat format carries the reasoning in `delta.reasoning_content`, a field `@ai-sdk/openai`
 * drops: it is read back off the raw chunk, as on OpenRouter, without OpenRouter's request fields.
 */
export const opencodeChatReasoningMiddleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({ ...params, includeRawChunks: true }),
    wrapStream: async ({ doStream }) => {
        const result = await doStream()
        let open = false
        return {
            ...result,
            stream: result.stream.pipeThrough(
                new TransformStream<StreamPart, StreamPart>({
                    transform(part, controller) {
                        if (part.type === 'raw') {
                            const delta = chunkReasoningDelta(part.rawValue)
                            if (delta) {
                                if (!open) controller.enqueue({ type: 'reasoning-start', id: REASONING_ID })
                                open = true
                                controller.enqueue({ type: 'reasoning-delta', id: REASONING_ID, delta })
                            }
                        } else if (open && closesReasoning(part as { type: string; delta?: unknown })) {
                            controller.enqueue({ type: 'reasoning-end', id: REASONING_ID })
                            open = false
                        }
                        controller.enqueue(part)
                    },
                    flush(controller) {
                        if (open) controller.enqueue({ type: 'reasoning-end', id: REASONING_ID })
                    },
                }),
            ),
        }
    },
}
