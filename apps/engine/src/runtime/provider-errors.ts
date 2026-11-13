import { APICallError, LoadAPIKeyError, RetryError } from 'ai'
import { CONTEXT_WINDOW, MODEL_NOT_IN_PLAN, OPENAI_API_CREDITS_USED_UP, PROVIDER_OVERLOADED, stripErrorPrefix, SUBSCRIPTION_LIMIT, type Provider } from '@rerun/contracts'
import { isRerunBudgetError, RERUN_BUDGET_ERROR_CODE } from './budget-latch.js'

export const RUN_ERROR_CODES = {
    usageLimit: 'provider_usage_limit',
    modelNotInPlan: 'provider_model_not_in_plan',
    unauthorized: 'provider_unauthorized',
    authRenewed: 'provider_auth_renewed',
    overloaded: 'provider_overloaded',
    contextWindow: 'provider_context_window',
    turnFailed: 'provider_turn_failed',
    streamIncomplete: 'provider_stream_incomplete',
    refused: 'provider_refused',
    engineRestarted: 'engine_restarted',
} as const

export type RunErrorCode = (typeof RUN_ERROR_CODES)[keyof typeof RUN_ERROR_CODES] | typeof RERUN_BUDGET_ERROR_CODE

// The raw finish reason `openrouterStreamRetryMiddleware` puts on a step whose stream was cut and
// could not be replayed. A finish rather than an error part: `onFinish` is the callback that keeps
// the steps the run had already completed.
export const STREAM_CUT_RAW_REASON = 'stream_cut'

// The message is what the chat classifies as an interrupted run, so the notice offers to pick the
// run back up instead of showing a raw stack.
export class ProviderStreamCutError extends Error {
    constructor() {
        super('the provider ended the turn without a result')
        this.name = 'ProviderStreamCutError'
    }
}

// A request the provider turned down as malformed: the same request will be turned down again, so
// the reason is kept in the message. It still reads "Provider returned error", which is what the chat
// classifies as a refusal.
export class ProviderRefusedError extends Error {
    constructor(reason: string | null) {
        super(reason ? `Provider returned error: ${reason}` : 'Provider returned error')
        this.name = 'ProviderRefusedError'
    }
}

// A 401 on a Claude token the engine itself replaced or let lapse while the run held it: the
// connection is fine, the run was only cut off, and the chat offers to pick it back up.
export class ClaudeSignInRenewedError extends Error {
    constructor() {
        super('interrupted: Claude sign-in renewed during the run')
        this.name = 'ClaudeSignInRenewedError'
    }
}

// The CLI providers report a failed turn as a *finish*, not as an error: codex maps
// `turn/completed status:'failed'` to a plain finish part carrying `usage_limit_exceeded` or
// `context_window_exceeded` as its raw reason, and claude-code does the same with
// `error_during_execution`. Without this table a spent subscription reads as a successful, empty
// turn: the run is stored `done`, a "completed" notification goes out and the curator runs.
const RAW_FINISH_CODES: Record<string, RunErrorCode> = {
    usage_limit_exceeded: RUN_ERROR_CODES.usageLimit,
    context_window_exceeded: RUN_ERROR_CODES.contextWindow,
    error_max_turns: RUN_ERROR_CODES.contextWindow,
    error_during_execution: RUN_ERROR_CODES.turnFailed,
    [STREAM_CUT_RAW_REASON]: RUN_ERROR_CODES.streamIncomplete,
}

export function classifyFinishReason(finishReason: string | undefined, rawFinishReason: string | undefined): RunErrorCode | null {
    if (rawFinishReason && RAW_FINISH_CODES[rawFinishReason]) return RAW_FINISH_CODES[rawFinishReason]
    if (finishReason === 'error') return RUN_ERROR_CODES.turnFailed
    return null
}

// `length` on its own is a genuine `max_tokens` truncation, which is a successful turn. Only a raw
// reason we recognise as a failure turns a finish into an error.
export function isFailedFinish(finishReason: string | undefined, rawFinishReason: string | undefined): boolean {
    return classifyFinishReason(finishReason, rawFinishReason) !== null
}

// A custom endpoint is a server its owner runs, often on their own machine: one that is stopped,
// asleep or out of the engine's reach fails before any HTTP status exists, and the SDK's own
// "Cannot connect to API" does not say which address it tried.
export class CustomEndpointUnreachableError extends Error {
    constructor(host: string, code: string) {
        super(`Could not reach the custom endpoint at ${host} (${code}). Check that the server is running and reachable from the engine.`)
        this.name = 'CustomEndpointUnreachableError'
    }
}

const UNREACHABLE = /\b(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)\b/

export function unreachableEndpointError(baseUrl: string | undefined, error: unknown): CustomEndpointUnreachableError | null {
    const cause = RetryError.isInstance(error) ? error.lastError : error
    const code = UNREACHABLE.exec(errorText(cause))?.[1] ?? UNREACHABLE.exec(errorText((cause as { cause?: unknown })?.cause))?.[1]
    if (!code) return null
    return new CustomEndpointUnreachableError(hostOf(baseUrl), code)
}

function hostOf(baseUrl: string | undefined): string {
    if (!baseUrl) return 'its address'
    try {
        return new URL(baseUrl).host
    } catch {
        return baseUrl
    }
}

function serialized(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}

function errorText(error: unknown): string {
    if (error instanceof Error) return `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`
    return typeof error === 'object' && error !== null ? serialized(error) : String(error)
}

// What a failed run stores and shows. `@ai-sdk/openai` hands an error event of the Responses stream
// over as the raw chunk, `{ type: 'error', error: { code, message } }`, which `String()` turns into
// "[object Object]".
export function errorMessageOf(error: unknown): string {
    if (error instanceof Error || typeof error !== 'object' || error === null) return String(error)
    const { message, error: inner } = error as { message?: unknown; error?: { message?: unknown } }
    const innerMessage = inner?.message
    if (typeof innerMessage === 'string' && innerMessage) return innerMessage
    if (typeof message === 'string' && message) return message
    return serialized(error)
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

// OpenRouter answers a refusal with its own "Provider returned error" and puts what the model provider
// said in `error.metadata.raw`, often a JSON body of its own. The SDK's parsed `data` drops `metadata`,
// so it is read from the raw response body.
export function upstreamReason(error: unknown): string | null {
    if (!APICallError.isInstance(error) || !error.responseBody) return null
    const body = parseJson(error.responseBody) as { error?: { message?: unknown; metadata?: { raw?: unknown } } } | null
    const raw = body?.error?.metadata?.raw
    if (typeof raw === 'string') {
        const nested = parseJson(raw) as { message?: unknown; error?: { message?: unknown } } | null
        const message = nested?.message ?? nested?.error?.message
        return typeof message === 'string' ? message : raw
    }
    const message = body?.error?.message
    return typeof message === 'string' && message !== error.message ? message : null
}

// `@ai-sdk/google` already makes the body's message the error's own, so `upstreamReason` finds
// nothing more in it: the error's message is then the reason, unless it is OpenRouter's bare refusal.
export function refusalReason(error: unknown): string | null {
    const upstream = upstreamReason(error)
    if (upstream) return upstream
    if (!APICallError.isInstance(error) || !error.responseBody) return null
    return /^provider returned error$/i.test(error.message.trim()) ? null : error.message
}

// The provider's own error code: on an error event of the OpenAI Responses stream, or in the body of
// a refused call, which the SDK keeps out of the error's message.
function providerErrorCodeOf(error: unknown): string | null {
    const cause = RetryError.isInstance(error) ? error.lastError : error
    if (APICallError.isInstance(cause)) {
        const body = (cause.data ?? (cause.responseBody ? parseJson(cause.responseBody) : null)) as { error?: { code?: unknown } } | null
        return typeof body?.error?.code === 'string' ? body.error.code : null
    }
    if (cause instanceof Error || typeof cause !== 'object' || cause === null) return null
    const code = (cause as { error?: { code?: unknown } }).error?.code
    return typeof code === 'string' ? code : null
}

// An OpenAI API key whose account has no prepaid credits left. Stored under the sentence the chat
// names OpenAI by, since OpenAI's older wording reads like any provider's rate limit.
class OpenAiCreditsError extends Error {
    constructor(reason: string) {
        super(`${OPENAI_API_CREDITS_USED_UP}: ${reason}`)
        this.name = 'OpenAiCreditsError'
    }
}

export function openAiCreditsError(provider: Provider, error: unknown): OpenAiCreditsError | null {
    if (provider !== 'openai') return null
    if (providerErrorCodeOf(error) !== 'insufficient_quota' && !/no credits remaining/i.test(errorText(error))) return null
    const cause = RetryError.isInstance(error) ? error.lastError : error
    return new OpenAiCreditsError(stripErrorPrefix(errorMessageOf(cause)))
}

function apiCallErrorCode(error: unknown): RunErrorCode | null {
    if (!APICallError.isInstance(error)) return null
    const data = error.data as { exitCode?: unknown; code?: unknown } | undefined
    if (error.statusCode === 401 || data?.exitCode === 401) return RUN_ERROR_CODES.unauthorized
    if (typeof data?.code === 'string' && /^(401|unauthorized|auth)$/i.test(data.code)) return RUN_ERROR_CODES.unauthorized
    if (error.statusCode === 429) return RUN_ERROR_CODES.overloaded
    if (error.isRetryable && PROVIDER_OVERLOADED.test(errorText(error))) return RUN_ERROR_CODES.overloaded
    return null
}

export function classifyProviderError(provider: Provider, error: unknown): RunErrorCode | null {
    if (provider === 'rerun' && isRerunBudgetError(error)) return RERUN_BUDGET_ERROR_CODE
    const text = `${errorText(error)} ${upstreamReason(error) ?? ''} ${providerErrorCodeOf(error) ?? ''}`
    // Both CLIs surface a spent subscription as free text on a generic error, with no status code
    // and no error kind of their own. Claude Code names the window that ran out rather than saying
    // "usage limit" at all: "You've hit your session limit · resets 3pm".
    if (MODEL_NOT_IN_PLAN.test(text)) return RUN_ERROR_CODES.modelNotInPlan
    if (SUBSCRIPTION_LIMIT.test(text)) return RUN_ERROR_CODES.usageLimit
    if (LoadAPIKeyError.isInstance(error)) return RUN_ERROR_CODES.unauthorized
    // The AI SDK gives up on a retryable status after its own attempts and wraps the last one.
    const fromApiCall = apiCallErrorCode(RetryError.isInstance(error) ? error.lastError : error)
    if (fromApiCall) return fromApiCall
    if (/not logged in|please login|invalid api key|invalid x-api-key|unauthorized|authentication failed|failed to authenticate|authentication_error|invalid bearer token|oauth token has expired|been revoked|no auth credentials|\b401\b/i.test(text)) return RUN_ERROR_CODES.unauthorized
    if (PROVIDER_OVERLOADED.test(text)) return RUN_ERROR_CODES.overloaded
    if (CONTEXT_WINDOW.test(text)) return RUN_ERROR_CODES.contextWindow
    // Checked last: a 400 that says why, a blown context or a bad key, is classified by its reason.
    if (APICallError.isInstance(error) && error.statusCode === 400) return RUN_ERROR_CODES.refused
    return null
}
