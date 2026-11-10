// No 'server-only', see client.ts: this is bundled into the Trigger.dev tasks too.
import { sleep } from '@rerun/contracts'
import type { ErrorResponse } from 'resend'

// Resend allows ten requests per second. The bucket lives on their side and is shared by the Next
// server and every Trigger.dev worker, which cannot see each other, so each process aims at half
// of it and the retry absorbs what that approximation lets through.
const MAX_REQUESTS_PER_SECOND = 5
const MIN_INTERVAL_MS = 1000 / MAX_REQUESTS_PER_SECOND
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

// 'rate_limited' is refused before the request is looked at, so nothing was sent and sending again
// is safe. 'rejected' would fail the same way forever. 'ambiguous' is the dangerous one: a network
// error or a 500 can land after Resend accepted the email, so replaying it may deliver twice.
export type ResendFailureKind = 'rate_limited' | 'rejected' | 'ambiguous'

export const RETRIABLE_MARKER = 'rate_limited: '
// No space, so the pattern never needs quoting on its way through PostgREST.
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

// resend@4 types the error as { name, message }, but the client hands back the parsed API body,
// which also carries statusCode. Neither shape alone is reliable, so both are read.
export function classifyResendError(error: unknown): ResendFailureKind {
    if (typeof error !== 'object' || error === null) return 'ambiguous'
    const { name, statusCode } = error as { name?: unknown; statusCode?: unknown }

    if (statusCode === 429 || (typeof name === 'string' && RATE_LIMIT_NAMES.has(name))) return 'rate_limited'
    if (typeof name === 'string' && REJECTION_NAMES.has(name)) return 'rejected'
    // A 4xx that is neither a timeout nor an idempotency conflict was refused before delivery.
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 409) return 'rejected'
    return 'ambiguous'
}

// The kind has to survive in the database: it is what tells a row that can be mailed again from one
// whose fate is unknown. newsletter_recipients.error is the only text column there is, so it
// carries both, and the prefix reads fine in the admin as it is.
export function failureMarker(error: ErrorResponse): string {
    return `${classifyResendError(error)}: ${error.message}`
}

export function isRetriableFailure(error: string | null): boolean {
    return error !== null && error.startsWith(RETRIABLE_MARKER)
}

export type ResendResult<T> = { data: T; error: null } | { data: null; error: ErrorResponse }

let nextSlot = 0

// Reserving the slot before awaiting is what makes concurrent callers queue behind each other
// instead of all reading the same free instant and leaving together.
async function takeSlot(): Promise<void> {
    const now = Date.now()
    const at = Math.max(now, nextSlot)
    nextSlot = at + MIN_INTERVAL_MS
    if (at > now) await sleep(at - now)
}

// Every Resend call goes through here. One unthrottled fan-out is enough to spend the whole
// per-second budget and take every other sender down with it. Only a rate limit is retried: a
// request that may already have been accepted is handed back for the caller to record as it is.
export async function sendThrottled<T>(call: () => Promise<ResendResult<T>>): Promise<ResendResult<T>> {
    for (let attempt = 0; ; attempt++) {
        await takeSlot()
        const result = await call()
        if (!result.error || attempt >= RETRY_DELAYS_MS.length) return result
        if (classifyResendError(result.error) !== 'rate_limited') return result
        await sleep(RETRY_DELAYS_MS[attempt])
    }
}
