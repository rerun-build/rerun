// What the chat can say something useful about. `generic` is the catch-all, and still gets a block
// of its own rather than the raw provider text.
export type ChatErrorKind = 'budget' | 'usage_limit' | 'unauthorized' | 'overloaded' | 'context_window' | 'provider_error' | 'thinking_replay' | 'interrupted' | 'run_in_flight' | 'generic'

// The AI SDK throws `new Error(await response.text())` on a failed /api/chat request, so
// what reaches the UI is the raw response body: the `Response.json({ error })` envelope of
// our own handlers, or an empty string when Next answers a 500 with no body at all.
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

// The engine stores `errorMessageOf(error)`, which keeps `String()` of an AI SDK error, so
// `runs.error` reads "AI_APICallError: You've hit your session limit". The class name means nothing
// to the person reading it: it never reaches the screen. Codex hands over the backend's whole JSON
// body (`{"type":"error","status":400,"error":{"message":"…"}}`), of which only the sentence is read.
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

// What the engine stores when OpenCode refuses a Console model for lack of credits (402), and when
// the Go plan is out on one of its windows. The window and its reset follow the second one:
// "OpenCode Go limit reached: weekly window · resets Nov 6, 3:00 PM UTC".
export const OPENCODE_CREDITS_USED_UP = 'OpenCode Console credits used up'
export const OPENCODE_GO_LIMIT = 'OpenCode Go limit reached'

// Claude Code builds its own sentence: "You've hit your ${limit}" with the limit named after the
// window that ran out (`session limit`, `weekly limit`, `Opus limit`, `Sonnet limit`), optionally
// followed by " · resets <time>". The older wording ("Claude AI usage limit reached|<epoch>") is
// still produced by older builds, and codex reports nothing but its raw finish reason.
//
// A model the plan does not include reads the same to the user, whose move is the same: pick
// another one. Claude says "Fable 5.1 requires usage credits" (or "You're out of usage credits"
// once they are spent), Codex "The 'gpt-6-astra' model is not supported when using Codex with a
// ChatGPT account". Shared with the engine's `classifyProviderError`, so both ends agree.
export const SUBSCRIPTION_LIMIT =
    /hit your (?:session|weekly|opus|sonnet|usage) limit|usage limit reached|usage_limit_exceeded|5-hour limit|quota exceeded|monthly spend limit|usage credits|not supported when using codex with a chatgpt account|does not exist or you do not have access|opencode console credits used up|opencode go limit reached/i

// Claude Code reports a dead OAuth token as "Failed to authenticate. API Error: 401 Invalid bearer
// token", OpenRouter as "No auth credentials found".
const PROVIDER_UNAUTHORIZED =
    /not logged in|please login|invalid api key|invalid x-api-key|unauthorized|authentication failed|failed to authenticate|authentication_error|invalid bearer token|oauth token has expired|been revoked|no auth credentials|\b401\b/

// A provider with no room for the request right now. Codex says so in its own words: "Selected
// model is at capacity. Please try a different model.", Gemini "This model is currently experiencing
// high demand." Shared with the engine's `classifyProviderError`.
export const PROVIDER_OVERLOADED = /overloaded|rate.?limit|too many requests|at capacity|high demand|service unavailable/i

// A conversation that no longer fits the model. Sending it again hits the same wall, so the way out
// is a larger model or a fresh conversation. Shared with the engine's `classifyProviderError`.
export const CONTEXT_WINDOW = /context.?window|too many tokens|prompt is too long/i

// The API quotes the field names ("Invalid `signature` in `thinking` block"), a copy pasted out of a
// chat often loses the backticks.
const THINKING_REPLAY_REJECTED = /invalid `?signature`? in `?thinking`? block/i

// Classified on the text rather than on a code, because what reaches the chat is `runs.error`, the
// flattened provider message the engine stored. The patterns mirror the engine's own
// `classifyProviderError`, so both ends agree on what a spent subscription looks like.
export function classifyChatError(message: string): ChatErrorKind {
    const m = message.toLowerCase()
    if (!m) return 'generic'
    // Anthropic refusing a thinking block the engine replayed against another tool list: the engine
    // built the request wrong, so another model fails the same way while a fresh run starts clean.
    // Checked first, since the refusal quotes message indexes ("messages.402") a looser test catches.
    if (THINKING_REPLAY_REJECTED.test(m)) return 'thinking_replay'
    if (m.includes('rerun_budget_exhausted') || m.includes('payment required') || m.includes('402')) return 'budget'
    if (m.includes('run_in_flight')) return 'run_in_flight'
    if (SUBSCRIPTION_LIMIT.test(m)) return 'usage_limit'
    if (m.includes('interrupted: engine restarted') || m.includes('interrupted: claude sign-in renewed') || m.includes('ended the turn without a result')) return 'interrupted'
    if (PROVIDER_UNAUTHORIZED.test(m)) return 'unauthorized'
    if (PROVIDER_OVERLOADED.test(m)) return 'overloaded'
    if (CONTEXT_WINDOW.test(m)) return 'context_window'
    // OpenRouter's own wording when the model provider behind it refuses the request. The refusal
    // repeats on every retry of the same conversation, so the way out is another model.
    if (m.includes('provider returned error')) return 'provider_error'
    return 'generic'
}
