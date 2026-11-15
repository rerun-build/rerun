export type ChatErrorKind = 'budget' | 'usage_limit' | 'unauthorized' | 'overloaded' | 'context_window' | 'provider_error' | 'thinking_replay' | 'interrupted' | 'run_in_flight' | 'session_gone' | 'generic'

export function unwrapChatError(raw: string | null | undefined): string {
    const message = (raw ?? '').trim()
    if (!message.startsWith('{')) return message

    try {
        const parsed = JSON.parse(message) as { error?: unknown }
        return typeof parsed.error === 'string' ? parsed.error : message
    } catch {
        return message
    }
}

export function stripErrorPrefix(message: string): string {
    const stripped = message.replace(/^(?:AI_)?[A-Za-z]*Error:\s*/, '').trim()
    if (!stripped.startsWith('{')) return stripped
    try {
        const parsed = JSON.parse(stripped) as { error?: { message?: unknown } }
        return typeof parsed.error?.message === 'string' ? parsed.error.message : stripped
    } catch {
        return stripped
    }
}

export const OPENCODE_CREDITS_USED_UP = 'OpenCode Console credits used up'
export const OPENCODE_GO_LIMIT = 'OpenCode Go limit reached'

export const SUBSCRIPTION_LIMIT =
    /hit your (?:session|weekly|opus|sonnet|usage) limit|usage limit reached|usage_limit_exceeded|5-hour limit|quota exceeded|monthly spend limit|usage credits|not supported when using codex with a chatgpt account|does not exist or you do not have access|opencode console credits used up|opencode go limit reached/i

export const MODEL_NOT_IN_PLAN = /not supported when using codex with a chatgpt account|does not exist or you do not have access|requires usage credits|model_not_found/i

const PROVIDER_UNAUTHORIZED =
    /not logged in|please login|invalid api key|invalid x-api-key|unauthorized|authentication failed|failed to authenticate|authentication_error|invalid bearer token|oauth token has expired|been revoked|no auth credentials|\b401\b/

export const PROVIDER_OVERLOADED = /overloaded|rate.?limit|too many requests|at capacity|high demand|service unavailable/i

export const CONTEXT_WINDOW = /context.?window|too many tokens|prompt is too long/i

const THINKING_REPLAY_REJECTED = /invalid `?signature`? in `?thinking`? block/i

export const ENGINE_SESSION_NOT_FOUND = 'session not found for this agent'
export const SESSION_NOT_FOUND = 'session_not_found'

export function classifyChatError(message: string): ChatErrorKind {
    const m = message.toLowerCase()
    if (!m) return 'generic'
    if (THINKING_REPLAY_REJECTED.test(m)) return 'thinking_replay'
    if (m.includes('rerun_budget_exhausted') || m.includes('payment required') || m.includes('402')) return 'budget'
    if (m.includes('run_in_flight')) return 'run_in_flight'
    if (m.includes(SESSION_NOT_FOUND) || m.includes(ENGINE_SESSION_NOT_FOUND)) return 'session_gone'
    if (SUBSCRIPTION_LIMIT.test(m)) return 'usage_limit'
    if (m.includes('interrupted: engine restarted') || m.includes('interrupted: claude sign-in renewed') || m.includes('ended the turn without a result')) return 'interrupted'
    if (PROVIDER_UNAUTHORIZED.test(m)) return 'unauthorized'
    if (PROVIDER_OVERLOADED.test(m)) return 'overloaded'
    if (CONTEXT_WINDOW.test(m)) return 'context_window'
    if (m.includes('provider returned error')) return 'provider_error'
    return 'generic'
}
