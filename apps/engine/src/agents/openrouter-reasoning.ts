import type { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelMiddleware } from 'ai'

type FetchFunction = NonNullable<NonNullable<Parameters<typeof createOpenAI>[0]>['fetch']>
type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type StreamResult = Awaited<ReturnType<Parameters<WrapStream>[0]['doStream']>>
type StreamPart = StreamResult['stream'] extends ReadableStream<infer Part> ? Part : never
type WrapGenerate = NonNullable<LanguageModelMiddleware['wrapGenerate']>
type GenerateResult = Awaited<ReturnType<Parameters<WrapGenerate>[0]['doGenerate']>>
type GeneratePart = GenerateResult['content'][number]

// `enabled` rather than an effort or a token budget: it asks OpenRouter to hand back the reasoning
// the model decides to produce, without buying more of it. Models that already reason (the one the
// keyless `rerun` provider serves) return it either way; the Anthropic family needs the ask.
const REASONING_REQUEST = { enabled: true }

// What a call cost and what it wrote into the prompt cache only come back in the last frame of the
// stream, and only when asked for.
const USAGE_REQUEST = { include: true }

export const REASONING_ID = 'reasoning-0'

/**
 * A thought ends when the model starts saying something, which is narrower than it sounds:
 * OpenRouter puts an empty `content` alongside every reasoning delta, so the chat model opens its
 * text block and emits an empty `text-delta` between two thoughts. Closing on those would cut the
 * thought into one block per chunk. `finish` covers a turn that reasons and then says nothing at
 * all, and `flush` covers a stream cut before it.
 */
export function closesReasoning(part: { type: string; delta?: unknown }): boolean {
    if (part.type === 'text-delta') return typeof part.delta === 'string' && part.delta.length > 0
    return part.type === 'tool-input-start' || part.type === 'tool-call' || part.type === 'finish'
}

/**
 * OpenRouter carries reasoning in a `reasoning` field of the delta, which the OpenAI chat wire
 * format has no room for. `@ai-sdk/openai` sends the request, so the field has to be added on its
 * way out, and the usage frame asked for in the same pass.
 */
export const reasoningFetch: FetchFunction = async (input, init) => {
    if (typeof init?.body !== 'string') return fetch(input, init)
    let body: Record<string, unknown>
    try {
        body = JSON.parse(init.body) as Record<string, unknown>
    } catch {
        return fetch(input, init)
    }
    return fetch(input, { ...init, body: JSON.stringify({ ...body, usage: body.usage ?? USAGE_REQUEST, reasoning: body.reasoning ?? REASONING_REQUEST }) })
}

function reasoningOf(delta: unknown): string | undefined {
    if (!delta || typeof delta !== 'object') return undefined
    const d = delta as { reasoning?: unknown; reasoning_content?: unknown }
    const text = typeof d.reasoning === 'string' ? d.reasoning : d.reasoning_content
    return typeof text === 'string' && text.length > 0 ? text : undefined
}

/** The reasoning delta of one raw SSE chunk, or undefined when it carries none. */
export function chunkReasoningDelta(rawValue: unknown): string | undefined {
    if (!rawValue || typeof rawValue !== 'object') return undefined
    const choices = (rawValue as { choices?: unknown }).choices
    if (!Array.isArray(choices)) return undefined
    return reasoningOf((choices[0] as { delta?: unknown } | undefined)?.delta)
}

/** The whole reasoning of a non-streamed response body, or undefined when it carries none. */
export function responseReasoning(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined
    const choices = (body as { choices?: unknown }).choices
    if (!Array.isArray(choices)) return undefined
    return reasoningOf((choices[0] as { message?: unknown } | undefined)?.message)
}

export type OpenRouterUsage = {
    cost?: number
    cost_details?: { upstream_inference_cost?: number | null } | null
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null
}

/** The usage frame of a raw chunk or of a response body, or undefined when it carries none. */
export function usageOf(value: unknown): OpenRouterUsage | undefined {
    if (!value || typeof value !== 'object') return undefined
    const usage = (value as { usage?: unknown }).usage
    return usage && typeof usage === 'object' ? (usage as OpenRouterUsage) : undefined
}

// On a call served with a provider key of our own, `cost` is OpenRouter's fee alone and what the
// provider billed comes apart in `upstream_inference_cost`, 0 or null on every other call.
export function usageCost(usage: OpenRouterUsage): number | undefined {
    if (typeof usage.cost !== 'number') return undefined
    const upstream = usage.cost_details?.upstream_inference_cost
    return usage.cost + (typeof upstream === 'number' ? upstream : 0)
}

type Metered = {
    usage?: { inputTokenDetails?: { cacheWriteTokens?: number } }
    providerMetadata?: Record<string, Record<string, unknown>>
}

// The chat schema of `@ai-sdk/openai` reads the cached tokens of the frame but not the written
// ones, and knows nothing of the cost: both are grafted on from the raw frame, where
// `costMicrosFrom` in the run loop and the step telemetry read them.
function withUsage<T extends Metered>(part: T, usage: OpenRouterUsage): T {
    const cost = usageCost(usage)
    const cacheWrite = usage.prompt_tokens_details?.cache_write_tokens
    const details = part.usage?.inputTokenDetails
    return {
        ...part,
        usage: details && typeof cacheWrite === 'number' ? { ...part.usage, inputTokenDetails: { ...details, cacheWriteTokens: details.cacheWriteTokens ?? cacheWrite } } : part.usage,
        providerMetadata: cost === undefined ? part.providerMetadata : { ...part.providerMetadata, openrouter: { ...part.providerMetadata?.openrouter, usage: { cost } } },
    }
}

/**
 * Turns the reasoning OpenRouter sends into the reasoning parts the AI SDK understands, and the
 * usage frame into the finish part's cost and cache numbers. Both fields are stripped by the chunk
 * schema of `@ai-sdk/openai` before any of this runs, so the raw chunk is the only place left to
 * read them: `transformParams` switches those on, and they are passed along untouched afterwards
 * (`streamText` drops them unless its own caller asked for them).
 */
export const openrouterReasoningMiddleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({ ...params, includeRawChunks: true }),
    wrapStream: async ({ doStream }) => {
        const result = await doStream()
        let open = false
        let usage: OpenRouterUsage | undefined
        return {
            ...result,
            stream: result.stream.pipeThrough(
                new TransformStream<StreamPart, StreamPart>({
                    transform(part, controller) {
                        const typed = part as StreamPart & { type: string; rawValue?: unknown; delta?: unknown }
                        if (typed.type === 'raw') {
                            usage = usageOf(typed.rawValue) ?? usage
                            const delta = chunkReasoningDelta(typed.rawValue)
                            if (delta) {
                                if (!open) {
                                    controller.enqueue({ type: 'reasoning-start', id: REASONING_ID } as StreamPart)
                                    open = true
                                }
                                controller.enqueue({ type: 'reasoning-delta', id: REASONING_ID, delta } as StreamPart)
                            }
                        } else if (open && closesReasoning(typed)) {
                            controller.enqueue({ type: 'reasoning-end', id: REASONING_ID } as StreamPart)
                            open = false
                        }
                        controller.enqueue(typed.type === 'finish' && usage ? (withUsage(typed as StreamPart & Metered, usage) as StreamPart) : part)
                    },
                    flush(controller) {
                        if (open) controller.enqueue({ type: 'reasoning-end', id: REASONING_ID } as StreamPart)
                    },
                }),
            ),
        }
    },
    wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate()
        const usage = usageOf(result.response?.body)
        const metered = usage ? (withUsage(result as GenerateResult & Metered, usage) as GenerateResult) : result
        const text = responseReasoning(result.response?.body)
        return text ? { ...metered, content: [{ type: 'reasoning', text } as GeneratePart, ...metered.content] } : metered
    },
}
