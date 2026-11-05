import { OPENCODE_CREDITS_USED_UP, OPENCODE_GO_LIMIT, classifyChatError, stripErrorPrefix, type ChatErrorKind } from './chat-error.js'
import { modelLabel } from './models.js'

const GENERIC_ERROR = 'Something went wrong. Try sending your message again.'

// The Rerun proxy returns 402 { error: 'rerun_budget_exhausted' } when a workspace
// has spent its monthly demo budget; the engine surfaces that marker in its run
// error. Runs after `unwrapChatError`, never before.
export function isBudgetExhausted(message: string): boolean {
    return classifyChatError(message) === 'budget'
}

// Which plan ran out, and over which window. Read from the text because that is all there is: the
// run carries no error code, and codex throws its server's message away and keeps only
// `usage_limit_exceeded` as a raw finish reason — which is precisely what identifies it, since
// claude-code's own raw reasons are `error_max_turns` and `error_during_execution`.
//
// `not_in_plan` is a model the plan does not include at all ("Fable 5.1 requires usage credits"),
// `credits` the paid overage spent, `spend` an organization's monthly cap.
export type SubscriptionLimit = {
    plan: 'claude' | 'chatgpt' | 'opencode' | null
    scope: 'session' | 'weekly' | 'monthly' | 'model' | 'not_in_plan' | 'credits' | 'spend'
    modelName?: string
    resetsAt?: string
}

// Claude appends " · resets 6:50pm (UTC)", Codex ends on "or try again at 4:44 PM.".
function resetTimeOf(message: string): string | undefined {
    const time = /· resets ([^·]+)/i.exec(message)?.[1] ?? /try again at (.+?)\.?$/i.exec(message)?.[1]
    return time?.trim() || undefined
}

function withReset(limit: SubscriptionLimit, message: string): SubscriptionLimit {
    const resetsAt = resetTimeOf(message)
    return resetsAt ? { ...limit, resetsAt } : limit
}

// Claude names the model by its label ("Fable 5.1 requires usage credits"), Codex by its id
// ("The 'gpt-6-astra' model is not supported", "The model `gpt-5.5` does not exist").
function modelNotInPlan(message: string): string | undefined {
    const label = /([\w.\- ]+?) requires usage credits/i.exec(message)?.[1]
    if (label) return label.trim()
    const id = /the '([^']+)' model is not supported/i.exec(message)?.[1] ?? /the model `([^`]+)` does not exist/i.exec(message)?.[1]
    return id ? modelLabel(id) : undefined
}

// The engine rewrites what OpenCode answers into these two sentences (see `opencodeFetch`): its own
// wording names neither the plan nor the window.
function opencodeLimit(message: string, m: string): SubscriptionLimit | null {
    if (m.includes(OPENCODE_CREDITS_USED_UP.toLowerCase())) return { plan: 'opencode', scope: 'credits' }
    if (!m.includes(OPENCODE_GO_LIMIT.toLowerCase())) return null
    const scope = m.includes('weekly') ? 'weekly' : m.includes('monthly') ? 'monthly' : 'session'
    return withReset({ plan: 'opencode', scope }, message)
}

export function describeSubscriptionLimit(raw: string): SubscriptionLimit {
    const message = stripErrorPrefix(raw)
    const m = message.toLowerCase()
    // Before the Claude rules: a Console model is often a Claude, and its 402 names it.
    const opencode = opencodeLimit(message, m)
    if (opencode) return opencode
    const codex = m.includes('codex') || m.includes('chatgpt')
    if (m.includes('requires usage credits')) return { plan: 'claude', scope: 'not_in_plan', modelName: modelNotInPlan(message) }
    if (m.includes('not supported when using codex') || m.includes('does not exist or you do not have access')) return { plan: codex ? 'chatgpt' : null, scope: 'not_in_plan', modelName: modelNotInPlan(message) }
    if (m.includes('out of usage credits')) return { plan: 'claude', scope: 'credits' }
    if (m.includes('monthly spend limit')) return { plan: 'claude', scope: 'spend' }
    if (m.includes('hit your usage limit')) return withReset({ plan: 'chatgpt', scope: 'session' }, message)
    if (m.includes('session limit') || m.includes('5-hour limit')) return withReset({ plan: 'claude', scope: 'session' }, message)
    if (m.includes('weekly limit')) return withReset({ plan: 'claude', scope: 'weekly' }, message)
    if (m.includes('opus limit')) return withReset({ plan: 'claude', scope: 'model', modelName: 'Opus' }, message)
    if (m.includes('sonnet limit')) return withReset({ plan: 'claude', scope: 'model', modelName: 'Sonnet' }, message)
    if (m.includes('usage_limit_exceeded')) return { plan: 'chatgpt', scope: 'session' }
    if (m.includes('claude')) return { plan: 'claude', scope: 'session' }
    return { plan: null, scope: 'session' }
}

const PLAN_LABELS: Record<'claude' | 'chatgpt' | 'opencode', string> = { claude: 'Claude', chatgpt: 'ChatGPT', opencode: 'OpenCode Go' }

const WINDOW_NAME: Record<'session' | 'weekly' | 'monthly', string> = { session: '5-hour', weekly: 'weekly', monthly: 'monthly' }

function opencodeLimitMessage(limit: SubscriptionLimit): string {
    if (limit.scope === 'credits') return 'No Console credits left. Add credits on opencode.ai, or pick a Go model to keep going.'
    const window = WINDOW_NAME[limit.scope as keyof typeof WINDOW_NAME] ?? '5-hour'
    return limit.resetsAt
        ? `Your OpenCode Go plan has reached its ${window} limit. It resets ${limit.resetsAt}; switch to a Console model or another provider until then.`
        : `Your OpenCode Go plan has reached its ${window} limit. Switch to a Console model or another provider until it resets.`
}

function opencodeLimitTitle(limit: SubscriptionLimit): string {
    if (limit.scope === 'credits') return 'OpenCode credits used up'
    if (limit.scope === 'weekly' || limit.scope === 'monthly') return `OpenCode Go ${limit.scope} limit reached`
    return 'OpenCode Go limit reached'
}

// The one line the notice puts under its title. It names the plan the user pays for rather than
// "the provider", because a Box can hold both and only one of them is out.
export function subscriptionLimitMessage(limit: SubscriptionLimit): string {
    if (limit.plan === 'opencode') return opencodeLimitMessage(limit)
    if (limit.scope === 'not_in_plan') {
        const model = limit.modelName ?? 'this model'
        if (!limit.plan) return `This connection can't run ${model}. Pick another model to keep going.`
        return `Your ${PLAN_LABELS[limit.plan]} plan doesn't include ${model}. Pick another model to keep going.`
    }
    if (!limit.plan) return 'This subscription has reached its usage limit. Switch to another model, or wait for the limit to reset.'
    const plan = PLAN_LABELS[limit.plan]
    if (limit.scope === 'credits') return `Your ${plan} plan has used up its usage credits. Pick a model your plan includes to keep going.`
    if (limit.scope === 'spend') return `Your organization has reached its monthly ${plan} spend limit. An admin can raise it; switch this coworker to another model in the meantime.`
    if (limit.scope === 'weekly') return limit.resetsAt ? `Your ${plan} plan has reached its weekly limit. It resets ${limit.resetsAt}; switch this coworker to another model until then.` : `Your ${plan} plan has reached its weekly limit. Switch this coworker to another model until the week rolls over.`
    if (limit.scope === 'model') return `Your ${plan} plan has reached its ${limit.modelName} limit. The other ${plan} models still run: switch to one of them.`
    return limit.resetsAt
        ? `Your ${plan} plan has used up its current usage window. It refills at ${limit.resetsAt}; switch this coworker to another model in the meantime.`
        : `Your ${plan} plan has used up its current usage window. It refills on its own; switch this coworker to another model in the meantime.`
}

export function subscriptionLimitTitle(limit: SubscriptionLimit): string {
    if (limit.plan === 'opencode') return opencodeLimitTitle(limit)
    if (limit.scope === 'not_in_plan') {
        if (!limit.plan) return `${limit.modelName ?? 'Model'} unavailable`
        return limit.modelName ? `${limit.modelName} isn't in your ${PLAN_LABELS[limit.plan]} plan` : `Model not in your ${PLAN_LABELS[limit.plan]} plan`
    }
    if (!limit.plan) return 'Usage limit reached'
    const plan = PLAN_LABELS[limit.plan]
    if (limit.scope === 'credits') return `${plan} usage credits used up`
    if (limit.scope === 'spend') return `${plan} spend limit reached`
    if (limit.scope === 'weekly' || limit.scope === 'monthly') return `${plan} ${limit.scope} limit reached`
    if (limit.scope === 'model') return `${plan} ${limit.modelName} limit reached`
    return `${plan} ${limit.plan === 'claude' ? 'session' : 'usage'} limit reached`
}

const KIND_TITLES: Record<Exclude<ChatErrorKind, 'generic' | 'usage_limit'>, string> = {
    budget: 'Rerun credits used up',
    unauthorized: 'Connection signed out',
    overloaded: 'Provider overloaded',
    context_window: 'Conversation too long',
    provider_error: 'The model could not answer',
    thinking_replay: 'The run could not continue',
    interrupted: 'Run interrupted',
    run_in_flight: 'This conversation is still busy',
}

// Codex's wording when one model has no room while the provider itself is fine: the notice names
// the model rather than the provider, and points at the other models as much as at a retry.
function isModelAtCapacity(kind: ChatErrorKind, message: string): boolean {
    return kind === 'overloaded' && /at capacity/i.test(message)
}

// A generic error has no headline worth more than its own text, so it gets none.
export function chatErrorTitle(kind: ChatErrorKind, message: string): string | null {
    if (kind === 'generic') return null
    if (kind === 'usage_limit') return subscriptionLimitTitle(describeSubscriptionLimit(message))
    if (isModelAtCapacity(kind, message)) return 'Model at capacity'
    return KIND_TITLES[kind]
}

const KIND_MESSAGES: Partial<Record<ChatErrorKind, string>> = {
    budget: 'Rerun credits used up for this period. Add credits or wait for the monthly reset.',
    unauthorized: 'This connection needs to be signed in again before the coworker can run.',
    overloaded: 'The provider is overloaded right now. Try again in a moment.',
    context_window: 'This conversation no longer fits the model, and sending it again will hit the same wall. Switch to a model with a larger context window, or start a new conversation.',
    provider_error: 'The model provider refused this request, and sending it again will get the same answer. Switch to another model to keep going.',
    thinking_replay: 'The engine replayed this turn in a way the model provider rejects. This is an engine bug, not the model: switching models will not help. Try again, and update the engine if it keeps happening.',
    interrupted: 'The run was cut off before it could finish.',
}

export function friendlyError(message: string): string {
    if (!message) return GENERIC_ERROR
    const kind = classifyChatError(message)
    if (kind === 'usage_limit') return subscriptionLimitMessage(describeSubscriptionLimit(message))
    if (isModelAtCapacity(kind, message)) return 'This model has no room right now. Try again in a moment or pick another model.'
    const known = KIND_MESSAGES[kind]
    if (known) return known
    return stripErrorPrefix(message) || GENERIC_ERROR
}

/**
 * The run a teammate holds the conversation with, when that is why a send was refused. Read from
 * the raw response body, before `unwrapChatError` reduces it to its `error` field.
 */
export function teammateRunOf(rawMessage: string): { runId: string | null } | null {
    try {
        const body = JSON.parse(rawMessage) as { heldByTeammate?: unknown; runId?: unknown }
        if (body.heldByTeammate !== true) return null
        return { runId: typeof body.runId === 'string' ? body.runId : null }
    } catch {
        return null
    }
}

// The send started the agent's install while another conversation already runs it: the chat
// answers with that conversation, for the tab to open instead of a second install.
export function installInFlightOf(rawMessage: string): { sessionId: string } | null {
    try {
        const body = JSON.parse(rawMessage) as { error?: unknown; sessionId?: unknown }
        if (body.error !== 'install_in_flight' || typeof body.sessionId !== 'string') return null
        return { sessionId: body.sessionId }
    } catch {
        return null
    }
}
