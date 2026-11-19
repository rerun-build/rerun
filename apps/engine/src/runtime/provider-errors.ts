import { APICallError, LoadAPIKeyError, RetryError } from 'ai'
import { CONTEXT_WINDOW, MODEL_NOT_IN_PLAN, PROVIDER_OVERLOADED, SUBSCRIPTION_LIMIT, type Provider } from '@moldwright/contracts'

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

export type RunErrorCode = (typeof RUN_ERROR_CODES)[keyof typeof RUN_ERROR_CODES]

export const STREAM_CUT_RAW_REASON = 'stream_cut'

export class ProviderStreamCutError extends Error {
    constructor() {
        super('the provider ended the turn without a result')
        this.name = 'ProviderStreamCutError'
    }
}

export class ProviderRefusedError extends Error {
    constructor(reason: string | null) {
        super(reason ? `Provider returned error: ${reason}` : 'Provider returned error')
        this.name = 'ProviderRefusedError'
    }
}

export class ClaudeSignInRenewedError extends Error {
    constructor() {
        super('interrupted: Claude sign-in renewed during the run')
        this.name = 'ClaudeSignInRenewedError'
    }
}

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

export function isFailedFinish(finishReason: string | undefined, rawFinishReason: string | undefined): boolean {
    return classifyFinishReason(finishReason, rawFinishReason) !== null
}

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

export function refusalReason(error: unknown): string | null {
    const upstream = upstreamReason(error)
    if (upstream) return upstream
    if (!APICallError.isInstance(error) || !error.responseBody) return null
    return /^provider returned error$/i.test(error.message.trim()) ? null : error.message
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
    const text = `${errorText(error)} ${upstreamReason(error) ?? ''}`
    if (MODEL_NOT_IN_PLAN.test(text)) return RUN_ERROR_CODES.modelNotInPlan
    if (SUBSCRIPTION_LIMIT.test(text)) return RUN_ERROR_CODES.usageLimit
    if (LoadAPIKeyError.isInstance(error)) return RUN_ERROR_CODES.unauthorized
    const fromApiCall = apiCallErrorCode(RetryError.isInstance(error) ? error.lastError : error)
    if (fromApiCall) return fromApiCall
    if (/not logged in|please login|invalid api key|invalid x-api-key|unauthorized|authentication failed|failed to authenticate|authentication_error|invalid bearer token|oauth token has expired|been revoked|no auth credentials|\b401\b/i.test(text)) return RUN_ERROR_CODES.unauthorized
    if (PROVIDER_OVERLOADED.test(text)) return RUN_ERROR_CODES.overloaded
    if (CONTEXT_WINDOW.test(text)) return RUN_ERROR_CODES.contextWindow
    if (APICallError.isInstance(error) && error.statusCode === 400) return RUN_ERROR_CODES.refused
    return null
}
