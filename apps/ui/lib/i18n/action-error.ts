import type { Messages } from '@rerun/i18n/messages'
import { ENGLISH_MESSAGES } from '@rerun/i18n/messages/en'
import { createTranslator } from 'use-intl'

export type ErrorCode = keyof Omit<Messages['errors'], '_context'>
export type ErrorParams = Record<string, string | number>
export type ActionFailure = { ok: false; error: string; code?: ErrorCode; params?: ErrorParams }

const english = createTranslator({ locale: 'en', messages: ENGLISH_MESSAGES, namespace: 'errors' })

export function isErrorCode(value: string): value is ErrorCode {
    return value !== '_context' && english.has(value as ErrorCode)
}

export function failure(code: ErrorCode, params?: ErrorParams): ActionFailure {
    return { ok: false, error: english(code, params as never), code, ...(params ? { params } : {}) }
}

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
