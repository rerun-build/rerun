import { sleep } from '@moldwright/contracts'
import type { ErrorResponse } from 'resend'

const MAX_REQUESTS_PER_SECOND = 5
const MIN_INTERVAL_MS = 1000 / MAX_REQUESTS_PER_SECOND
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

export type ResendFailureKind = 'rate_limited' | 'rejected' | 'ambiguous'

export const RETRIABLE_MARKER = 'rate_limited: '
export const RETRIABLE_ERROR_PATTERN = 'rate_limited:%'

const RATE_LIMIT_NAMES = new Set(['rate_limit_exceeded', 'too_many_requests'])
const REJECTION_NAMES = new Set([
    'validation_error',
    'invalid_parameter',
    'invalid_access',
    'invalid_region',
    'missing_required_field',
    'invalid_from_address',
    'invalid_api_Key',
    'missing_api_key',
    'not_found',
    'method_not_allowed',
])

export function classifyResendError(error: unknown): ResendFailureKind {
    if (typeof error !== 'object' || error === null) return 'ambiguous'
    const { name, statusCode } = error as { name?: unknown; statusCode?: unknown }

    if (statusCode === 429 || (typeof name === 'string' && RATE_LIMIT_NAMES.has(name))) return 'rate_limited'
    if (typeof name === 'string' && REJECTION_NAMES.has(name)) return 'rejected'
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 409) return 'rejected'
    return 'ambiguous'
}

export function failureMarker(error: ErrorResponse): string {
    return `${classifyResendError(error)}: ${error.message}`
}

export function isRetriableFailure(error: string | null): boolean {
    return error !== null && error.startsWith(RETRIABLE_MARKER)
}

export type ResendResult<T> = { data: T; error: null } | { data: null; error: ErrorResponse }

let nextSlot = 0

async function takeSlot(): Promise<void> {
    const now = Date.now()
    const at = Math.max(now, nextSlot)
    nextSlot = at + MIN_INTERVAL_MS
    if (at > now) await sleep(at - now)
}

export async function sendThrottled<T>(call: () => Promise<ResendResult<T>>): Promise<ResendResult<T>> {
    for (let attempt = 0; ; attempt++) {
        await takeSlot()
        const result = await call()
        if (!result.error || attempt >= RETRY_DELAYS_MS.length) return result
        if (classifyResendError(result.error) !== 'rate_limited') return result
        await sleep(RETRY_DELAYS_MS[attempt])
    }
}
