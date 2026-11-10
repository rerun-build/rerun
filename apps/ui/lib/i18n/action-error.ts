import type { Messages } from '@rerun/i18n/messages'
import { ENGLISH_MESSAGES } from '@rerun/i18n/messages/en'
import { createTranslator } from 'use-intl'

// A refusal a server action sends back to the screen: a key of the `errors` namespace the screen
// translates, and the English text for the logs and the clients that predate the codes (the iOS app).
export type ErrorCode = keyof Omit<Messages['errors'], '_context'>
export type ErrorParams = Record<string, string | number>
export type ActionFailure = { ok: false; error: string; code?: ErrorCode; params?: ErrorParams }

const english = createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace: 'errors' })

// A zod schema shared with the server names its refusal by code, so the action can send it translated.
export function isErrorCode(value: string): value is ErrorCode {
    return value !== '_context' && english.has(value as ErrorCode)
}

export function failure(code: ErrorCode, params?: ErrorParams): ActionFailure {
    return { ok: false, error: english(code, params as never), code, ...(params ? { params } : {}) }
}

// Thrown by a service deep down, turned into a failure by the action that catches it.
export class AppError extends Error {
    constructor(
        readonly code: ErrorCode,
        readonly params?: ErrorParams,
    ) {
        super(english(code, params as never))
    }
}

export function failureOf(err: unknown, fallback: ErrorCode = 'generic'): ActionFailure {
    if (err instanceof AppError) return failure(err.code, err.params)
    return { ok: false, error: err instanceof Error ? err.message : english(fallback), code: err instanceof Error ? undefined : fallback }
}

// The same refusal for the older results shaped `{ success: false, error }`.
export type ActionRefusal = Omit<ActionFailure, 'ok'>

export function refusal(code: ErrorCode, params?: ErrorParams): ActionRefusal {
    const { ok: _ok, ...rest } = failure(code, params)
    return rest
}

export function refusalOf(err: unknown, fallback: ErrorCode = 'generic'): ActionRefusal {
    const { ok: _ok, ...rest } = failureOf(err, fallback)
    return rest
}

export type SuccessResult = { success: boolean } & Partial<ActionRefusal>
