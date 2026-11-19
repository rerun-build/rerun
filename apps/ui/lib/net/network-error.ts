import { refusal, refusalOf, type ActionRefusal, type ErrorCode } from '@/lib/i18n/action-error'

// Node's fetch (undici) rejects with a bare `TypeError: fetch failed` when the host does not answer,
// and AbortSignal.timeout() aborts with a `TimeoutError`. Neither means anything to a person.
// An `AbortError` is a caller stopping on purpose (a Stop button): it is not a network failure.
export function isNetworkFailure(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    if (err.name === 'TimeoutError') return true
    return err instanceof TypeError && err.message === 'fetch failed'
}

// What a sign-in route answers when it fails: a third party that did not answer (Composio, an MCP
// server's OAuth endpoints) gets a sentence, any other error keeps its own refusal.
export function signInRefusal(err: unknown, fallback: ErrorCode): ActionRefusal {
    if (isNetworkFailure(err)) return refusal('signInServiceUnreachable')
    return refusalOf(err, fallback)
}
