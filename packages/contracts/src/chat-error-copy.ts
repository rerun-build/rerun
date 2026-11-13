import { OPENAI_API_CREDITS, OPENCODE_CREDITS_USED_UP, OPENCODE_GO_LIMIT, classifyChatError, stripErrorPrefix, type ChatErrorKind } from './chat-error.js'
import { modelLabel } from './models.js'

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
// `credits` the paid overage spent (or, on `openai`, the API account's prepaid credits), `spend` an
// organization's monthly cap.
export type SubscriptionLimit = {
    plan: 'claude' | 'chatgpt' | 'opencode' | 'openai' | null
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
    if (OPENAI_API_CREDITS.test(message)) return { plan: 'openai', scope: 'credits' }
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

type TitledKind = Exclude<ChatErrorKind, 'generic' | 'usage_limit'>
type ExplainedKind = Exclude<TitledKind, 'run_in_flight'>

const EXPLAINED_KINDS: readonly ExplainedKind[] = ['budget', 'unauthorized', 'overloaded', 'context_window', 'provider_error', 'thinking_replay', 'interrupted', 'session_gone']

type LimitTitleKey = 'usageLimit' | 'modelUnavailable' | 'anyModelUnavailable' | 'modelNotInPlan' | 'anyModelNotInPlan' | 'credits' | 'spend' | 'window' | 'model' | 'claudeSession' | 'usage' | 'opencodeCredits' | 'opencodeWindow' | 'opencode' | 'openaiCredits'
type LimitMessageKey = 'openaiCredits' | 'opencodeCredits' | 'opencodeWindowResets' | 'opencodeWindow' | 'modelUnavailable' | 'anyModelUnavailable' | 'modelNotInPlan' | 'anyModelNotInPlan' | 'usageLimit' | 'credits' | 'spend' | 'weeklyResets' | 'weekly' | 'model' | 'sessionResets' | 'session'

// The `chatErrors` namespace: next-intl's, use-intl's or the server's `t` of it fits as is.
export type ChatErrorCopy = (key: 'generic' | 'modelAtCapacity.title' | 'modelAtCapacity.message' | `titles.${TitledKind}` | `messages.${ExplainedKind}` | `limits.titles.${LimitTitleKey}` | `limits.messages.${LimitMessageKey}`, values?: Record<string, string>) => string

function opencodeLimitMessage(limit: SubscriptionLimit, t: ChatErrorCopy): string {
    if (limit.scope === 'credits') return t('limits.messages.opencodeCredits')
    return limit.resetsAt ? t('limits.messages.opencodeWindowResets', { window: limit.scope, resetsAt: limit.resetsAt }) : t('limits.messages.opencodeWindow', { window: limit.scope })
}

function opencodeLimitTitle(limit: SubscriptionLimit, t: ChatErrorCopy): string {
    if (limit.scope === 'credits') return t('limits.titles.opencodeCredits')
    if (limit.scope === 'weekly' || limit.scope === 'monthly') return t('limits.titles.opencodeWindow', { window: limit.scope })
    return t('limits.titles.opencode')
}

// The one line the notice puts under its title. It names the plan the user pays for rather than
// "the provider", because a Box can hold both and only one of them is out.
export function subscriptionLimitMessage(limit: SubscriptionLimit, t: ChatErrorCopy): string {
    if (limit.plan === 'opencode') return opencodeLimitMessage(limit, t)
    if (limit.plan === 'openai') return t('limits.messages.openaiCredits')
    if (limit.scope === 'not_in_plan') {
        const model = limit.modelName
        if (!limit.plan) return model ? t('limits.messages.modelUnavailable', { model }) : t('limits.messages.anyModelUnavailable')
        const plan = PLAN_LABELS[limit.plan]
        return model ? t('limits.messages.modelNotInPlan', { plan, model }) : t('limits.messages.anyModelNotInPlan', { plan })
    }
    if (!limit.plan) return t('limits.messages.usageLimit')
    const plan = PLAN_LABELS[limit.plan]
    if (limit.scope === 'credits') return t('limits.messages.credits', { plan })
    if (limit.scope === 'spend') return t('limits.messages.spend', { plan })
    if (limit.scope === 'weekly') return limit.resetsAt ? t('limits.messages.weeklyResets', { plan, resetsAt: limit.resetsAt }) : t('limits.messages.weekly', { plan })
    if (limit.scope === 'model') return t('limits.messages.model', { plan, model: limit.modelName ?? '' })
    return limit.resetsAt ? t('limits.messages.sessionResets', { plan, resetsAt: limit.resetsAt }) : t('limits.messages.session', { plan })
}

export function subscriptionLimitTitle(limit: SubscriptionLimit, t: ChatErrorCopy): string {
    if (limit.plan === 'opencode') return opencodeLimitTitle(limit, t)
    if (limit.plan === 'openai') return t('limits.titles.openaiCredits')
    if (limit.scope === 'not_in_plan') {
        const model = limit.modelName
        if (!limit.plan) return model ? t('limits.titles.modelUnavailable', { model }) : t('limits.titles.anyModelUnavailable')
        const plan = PLAN_LABELS[limit.plan]
        return model ? t('limits.titles.modelNotInPlan', { plan, model }) : t('limits.titles.anyModelNotInPlan', { plan })
    }
    if (!limit.plan) return t('limits.titles.usageLimit')
    const plan = PLAN_LABELS[limit.plan]
    if (limit.scope === 'credits') return t('limits.titles.credits', { plan })
    if (limit.scope === 'spend') return t('limits.titles.spend', { plan })
    if (limit.scope === 'weekly' || limit.scope === 'monthly') return t('limits.titles.window', { plan, window: limit.scope })
    if (limit.scope === 'model') return t('limits.titles.model', { plan, model: limit.modelName ?? '' })
    return limit.plan === 'claude' ? t('limits.titles.claudeSession', { plan }) : t('limits.titles.usage', { plan })
}

// Codex's wording when one model has no room while the provider itself is fine: the notice names
// the model rather than the provider, and points at the other models as much as at a retry.
function isModelAtCapacity(kind: ChatErrorKind, message: string): boolean {
    return kind === 'overloaded' && /at capacity/i.test(message)
}

// A generic error has no headline worth more than its own text, so it gets none.
export function chatErrorTitle(kind: ChatErrorKind, message: string, t: ChatErrorCopy): string | null {
    if (kind === 'generic') return null
    if (kind === 'usage_limit') return subscriptionLimitTitle(describeSubscriptionLimit(message), t)
    if (isModelAtCapacity(kind, message)) return t('modelAtCapacity.title')
    return t(`titles.${kind}`)
}

const isExplainedKind = (kind: ChatErrorKind): kind is ExplainedKind => (EXPLAINED_KINDS as readonly ChatErrorKind[]).includes(kind)

// An error no kind explains reads as the provider wrote it, untranslated: it is all there is to say.
export function friendlyError(message: string, t: ChatErrorCopy): string {
    if (!message) return t('generic')
    const kind = classifyChatError(message)
    if (kind === 'usage_limit') return subscriptionLimitMessage(describeSubscriptionLimit(message), t)
    if (isModelAtCapacity(kind, message)) return t('modelAtCapacity.message')
    if (isExplainedKind(kind)) return t(`messages.${kind}`)
    return stripErrorPrefix(message) || t('generic')
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
