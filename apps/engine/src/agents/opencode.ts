import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelMiddleware, wrapLanguageModel } from 'ai'
import { CONNECTION_TOKEN_KEY, OPENCODE_CREDITS_USED_UP, OPENCODE_GO_LIMIT, OPENCODE_SESSION_HEADER, isFreeOpencodeModel, type OpencodeModel, type OpencodeWire, type PlanLimitWindow, type Provider } from '@rerun/contracts'
import { forceOpencodeCatalogRefresh, opencodeModel } from '../connections/opencode-catalog.js'
import { refreshOpencodePlanLimits } from '../connections/opencode-plan-limits.js'
import { spentPlanWindow } from '../connections/plan-limits.js'
import type { LoadedConnection } from '../connections/types.js'
import { opencodeUserAgent } from '../runtime/build-info.js'
import { googleToolSchemaMiddleware } from './google-tool-schema.js'
import { openrouterStreamRetryMiddleware } from './openrouter-stream-retry.js'
import { opencodeChatReasoningMiddleware } from './opencode-stream.js'

type FetchFunction = typeof globalThis.fetch

// What an OpenCode model behaves like everywhere a provider is switched on (caching, reasoning,
// screenshots): the provider whose wire format it is served on. `openrouter` stands for the OpenAI
// chat format, which is what OpenRouter speaks.
export type OpencodeBehaviour = 'anthropic' | 'openai' | 'openrouter' | 'google'

const BEHAVIOUR_OF_WIRE: Record<OpencodeWire, OpencodeBehaviour> = { anthropic: 'anthropic', responses: 'openai', chat: 'openrouter', google: 'google' }

export function opencodeBehaviour(model: string): OpencodeBehaviour | undefined {
    const entry = opencodeModel(model)
    return entry && BEHAVIOUR_OF_WIRE[entry.wire]
}

// The provider a model behaves like: itself, or for OpenCode the one its wire format belongs to.
export function behaviourOf(provider: Provider, model: string): Provider {
    if (provider !== 'opencode') return provider
    return opencodeBehaviour(model) ?? 'openrouter'
}

// An image sent to a model that cannot see is dropped by OpenCode without a word: the engine has
// to know before it sends one. A custom endpoint says nothing about it, so its owner does, and the
// default is no: a text-only local model answers an image with an error. Every other provider is
// trusted with the images it is handed.
export function modelSeesImages(provider: Provider, model: string, connection?: LoadedConnection | null): boolean {
    if (provider === 'custom') return connection?.config.vision === true
    if (provider !== 'opencode') return true
    return opencodeModel(model)?.images ?? true
}

// The model a `vision_analyze` call goes to when the run's own model cannot see: the cheapest Go
// model switched on for this connection that can, since Go is already paid for. Never a free one:
// its endpoint can train on what it is sent, so it only runs when a member picks it on purpose.
export function opencodeVisionModel(connection: LoadedConnection | null): string | null {
    const seeing = (connection?.config.models ?? [])
        .map(opencodeModel)
        .filter((model): model is OpencodeModel => !!model && model.images && !isFreeOpencodeModel(model.price))
        .sort((a, b) => Number(b.plan === 'go') - Number(a.plan === 'go') || a.price.input + a.price.output - (b.price.input + b.price.output))
    return seeing[0]?.id ?? null
}

// The SDK caps an id it does not know at 4096 output tokens, which cuts a file written through a
// tool call in the middle of its argument.
const MAX_OUTPUT_TOKENS_CEILING = 32_000

const RESET_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })

const WINDOW_NAME: Record<PlanLimitWindow['kind'], string> = { session: '5-hour', weekly: 'weekly', monthly: 'monthly', model: 'model' }

function goLimitMessage(window: PlanLimitWindow): string {
    const reset = window.resetsAt ? ` · resets ${RESET_FORMAT.format(new Date(window.resetsAt))}` : ''
    return `${OPENCODE_GO_LIMIT}: ${WINDOW_NAME[window.kind]} window${reset}`
}

function messageOf(text: string): string {
    try {
        const body = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown }
        const message = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message)
        if (typeof message === 'string' && message) return message
    } catch {
        // Not JSON: the text itself is the message.
    }
    return text.trim()
}

type RefusalContext = { connection: LoadedConnection | null; model: OpencodeModel }

// OpenCode's refusals name neither the plan nor the window, and the chat classifies what it reads.
// They are rewritten into the sentences `describeSubscriptionLimit` knows, in a body every one of
// the three SDKs parses (`error.message` on all of them, `type` for Anthropic, `status` for Google).
async function rewrittenRefusal(status: number, original: string, { connection, model }: RefusalContext): Promise<string | null> {
    if (status === 401) return `OpenCode key refused (401): ${original}`
    if (status === 402) return `${OPENCODE_CREDITS_USED_UP}: ${original}`
    if (status === 400 && /model is unavailable/i.test(original)) {
        forceOpencodeCatalogRefresh()
        return `Provider returned error: OpenCode no longer offers ${model.label} (${original})`
    }
    // A 429 is a plain rate limit until the account's usage, read again now, says a window is spent.
    if (status === 429 && model.plan === 'go' && connection) {
        await refreshOpencodePlanLimits(connection)
        const spent = spentPlanWindow(connection.id)
        return spent ? goLimitMessage(spent) : null
    }
    return null
}

async function withRewrittenRefusal(response: Response, context: RefusalContext): Promise<Response> {
    if (response.ok) return response
    const text = await response.text()
    const message = await rewrittenRefusal(response.status, messageOf(text), context)
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    if (!message) return new Response(text, { status: response.status, statusText: response.statusText, headers })
    headers.set('content-type', 'application/json')
    const body = { type: 'error', error: { type: 'opencode_error', message, code: response.status, status: 'OPENCODE_ERROR' } }
    return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers })
}

/**
 * Every request to OpenCode carries the conversation it belongs to (refused without it) and the
 * engine's name. A redirect is refused rather than followed: `x-api-key` and `x-goog-api-key` would
 * ride along to wherever it points.
 */
export function opencodeFetch({ sessionId, ...context }: RefusalContext & { sessionId: string }, inner: FetchFunction = fetch): FetchFunction {
    return async (input, init) => {
        const headers = new Headers(init?.headers)
        headers.set(OPENCODE_SESSION_HEADER, sessionId)
        headers.set('User-Agent', opencodeUserAgent())
        return withRewrittenRefusal(await inner(input, { ...init, headers, redirect: 'error' }), context)
    }
}

const maxOutputTokensMiddleware = (outputLimit: number): LanguageModelMiddleware => ({
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({ ...params, maxOutputTokens: params.maxOutputTokens ?? Math.min(outputLimit, MAX_OUTPUT_TOKENS_CEILING) }),
})

// Without it the SDK points back at earlier items by reference (`item_reference`), which only
// OpenAI's own store can resolve.
const responsesStoreOffMiddleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => ({ ...params, providerOptions: { ...params.providerOptions, openai: { ...params.providerOptions?.openai, store: false } } }),
}

type LanguageModelV3 = Parameters<typeof wrapLanguageModel>[0]['model']

export type OpencodeLanguageModel = { model: LanguageModelV3; entry: OpencodeModel; middleware: LanguageModelMiddleware[] }

export class OpencodeModelError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'OpencodeModelError'
    }
}

/**
 * The model behind a `go/…` or `console/…` id, on the SDK of the format OpenCode serves it on. Only
 * the id without its plan leaves the box: Google puts it in the URL path. No `name` is passed to
 * the SDKs, so each keeps reading its own `providerOptions` key (`anthropic`, `openai`, `google`).
 */
export function opencodeLanguageModel(connection: LoadedConnection | null, modelId: string, sessionId: string): OpencodeLanguageModel {
    const apiKey = connection?.env[CONNECTION_TOKEN_KEY.opencode]
    if (!apiKey) throw new OpencodeModelError('This OpenCode connection has no key. Add it again in AI providers.')
    const entry = opencodeModel(modelId)
    if (!entry) throw new OpencodeModelError(`OpenCode does not offer ${modelId}. Pick another model.`)
    const options = { apiKey, baseURL: entry.baseUrl, fetch: opencodeFetch({ sessionId, connection, model: entry }) }
    switch (entry.wire) {
        case 'anthropic':
            return { model: createAnthropic(options)(entry.upstreamId), entry, middleware: [maxOutputTokensMiddleware(entry.outputLimit)] }
        case 'responses':
            return { model: createOpenAI(options).responses(entry.upstreamId), entry, middleware: [responsesStoreOffMiddleware] }
        case 'chat':
            return { model: createOpenAI(options).chat(entry.upstreamId), entry, middleware: [openrouterStreamRetryMiddleware, opencodeChatReasoningMiddleware] }
        case 'google':
            return { model: createGoogleGenerativeAI(options)(entry.upstreamId), entry, middleware: [googleToolSchemaMiddleware] }
    }
}
