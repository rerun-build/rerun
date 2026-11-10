import { englishTranslator } from '@/lib/i18n/english-translator'
import { loadMessages } from '@rerun/i18n/messages'
import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'
import { chatErrorTitle as titleIn, classifyChatError, describeSubscriptionLimit, friendlyError as friendlyIn, isBudgetExhausted, stripErrorPrefix, installInFlightOf, subscriptionLimitMessage, subscriptionLimitTitle, teammateRunOf, unwrapChatError, type ChatErrorKind, type SubscriptionLimit } from './chat-error'

const english = englishTranslator('chatErrors')
const french = createTranslator({ locale: 'fr', messages: await loadMessages('fr'), namespace: 'chatErrors' })
const friendlyError = (message: string) => friendlyIn(message, english)
const chatErrorTitle = (kind: ChatErrorKind, message: string) => titleIn(kind, message, english)

describe('unwrapChatError', () => {
    it('reads the error field of a JSON envelope', () => {
        expect(unwrapChatError('{"error":"Engine error: 502 upstream down"}')).toBe('Engine error: 502 upstream down')
    })

    it('keeps a plain message as-is', () => {
        expect(unwrapChatError('Failed to fetch')).toBe('Failed to fetch')
    })

    it('keeps a JSON body that carries no error field', () => {
        expect(unwrapChatError('{"status":"ko"}')).toBe('{"status":"ko"}')
    })

    it('keeps a truncated JSON body', () => {
        expect(unwrapChatError('{"error":"Engine err')).toBe('{"error":"Engine err')
    })

    it('normalizes an absent message to an empty string', () => {
        expect(unwrapChatError(undefined)).toBe('')
        expect(unwrapChatError('   ')).toBe('')
    })

    it('preserves the budget marker for isBudgetExhausted', () => {
        expect(isBudgetExhausted(unwrapChatError('{"error":"rerun_budget_exhausted"}'))).toBe(true)
    })
})

describe('friendlyError', () => {
    it('falls back to a generic message when the error carries no text', () => {
        expect(friendlyError('')).toBe('Something went wrong. Try sending your message again.')
    })

    it('humanizes the budget marker', () => {
        expect(friendlyError('rerun_budget_exhausted')).toContain('Rerun credits used up')
    })

    it('passes any other message through', () => {
        expect(friendlyError('Missing message text')).toBe('Missing message text')
    })

    it('drops the AI SDK class name the engine stored', () => {
        expect(friendlyError('AI_APICallError: fetch failed')).toBe('fetch failed')
    })
})

describe('stripErrorPrefix', () => {
    it('removes the class name String(error) put in front', () => {
        expect(stripErrorPrefix('AI_APICallError: fetch failed')).toBe('fetch failed')
        expect(stripErrorPrefix('Error: ECONNRESET')).toBe('ECONNRESET')
        expect(stripErrorPrefix('Error: {"type":"error","status":400,"error":{"message":"The model is gone."}}')).toBe('The model is gone.')
    })

    it('leaves a message that never had one', () => {
        expect(stripErrorPrefix('Missing message text')).toBe('Missing message text')
    })
})

describe('classifyChatError', () => {
    // The engine flattens the provider error into `runs.error`, so these are the strings the two
    // CLI providers actually produce when a subscription runs out or a login expires.
    it('recognises a spent subscription from either CLI', () => {
        expect(classifyChatError('Error: Claude AI usage limit reached|1750000000')).toBe('usage_limit')
        expect(classifyChatError('Error: usage_limit_exceeded')).toBe('usage_limit')
    })

    // Claude Code stopped saying "usage limit" and now names the window that ran out. Without these
    // the sentence fell through to `generic` and the chat printed the raw provider stack.
    it('recognises every window claude code names', () => {
        expect(classifyChatError("AI_APICallError: You've hit your session limit · resets 3pm")).toBe('usage_limit')
        expect(classifyChatError("AI_APICallError: You've hit your weekly limit · resets Nov 20, 3pm")).toBe('usage_limit')
        expect(classifyChatError("AI_APICallError: You've hit your Opus limit · resets 3pm")).toBe('usage_limit')
        expect(classifyChatError("AI_APICallError: You've hit your Sonnet limit")).toBe('usage_limit')
    })

    it('recognises a connection that needs signing in again', () => {
        expect(classifyChatError('LoadAPIKeyError: Authentication failed. Ensure Codex CLI is logged in.')).toBe('unauthorized')
        expect(classifyChatError('AI_LoadAPIKeyError: Failed to authenticate. API Error: 401 Invalid bearer token')).toBe('unauthorized')
        expect(classifyChatError('OAuth token has expired or been revoked (401).')).toBe('unauthorized')
        expect(classifyChatError('No auth credentials found')).toBe('unauthorized')
        expect(classifyChatError('AI_LoadAPIKeyError: Failed to authenticate. API Error: 401 OAuth access token has been revoked.')).toBe('unauthorized')
    })

    // OpenRouter's sentence when the model provider behind it refuses the request: the same request
    // fails the same way on every retry, so the run stopped as `generic` with nothing to click.
    it('recognises a request the model provider refused', () => {
        expect(classifyChatError('AI_APICallError: Provider returned error')).toBe('provider_error')
        expect(classifyChatError('ProviderRefusedError: Provider returned error: tools.0.custom.input_schema: invalid')).toBe('provider_error')
    })

    // Anthropic refusing a signed thinking block the engine replayed against another tool list. It
    // reads "Provider returned error" too, but switching models does not help: a fresh run does.
    it('tells a rejected thinking replay apart from a refusal', () => {
        const fromApi = 'ProviderRefusedError: Provider returned error: messages.25.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. The `tools` list differs from the one this block was created with.'
        const pastedWithoutBackticks = 'ProviderRefusedError: Provider returned error: messages.402.content.0: Invalid signature in thinking block. The block is bound to a different conversation.'
        expect(classifyChatError(fromApi)).toBe('thinking_replay')
        expect(classifyChatError(pastedWithoutBackticks)).toBe('thinking_replay')
        expect(chatErrorTitle('thinking_replay', fromApi)).toBe('The run could not continue')
        expect(friendlyError(fromApi)).toContain('switching models will not help')
    })

    // The engine keeps the provider's reason in the run's error for the logs; the chat says what to do.
    it('tells the user a refusal will repeat, without the technical reason', () => {
        const message = friendlyError('ProviderRefusedError: Provider returned error: tools.0.custom.input_schema: invalid')
        expect(message).toContain('sending it again will get the same answer')
        expect(message).not.toContain('input_schema')
    })

    // Codex's own sentence when the model has no room for the request: it used to fall through to
    // `generic`, a notice with nothing to click.
    it('recognises a model at capacity as an overloaded provider', () => {
        expect(classifyChatError('Error: Selected model is at capacity. Please try a different model.')).toBe('overloaded')
        expect(classifyChatError('Error: exceeded retry limit, last status: 429 Too Many Requests')).toBe('overloaded')
        expect(classifyChatError('Message failed: AI_RetryError: Failed after 3 attempts. Last error: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.')).toBe('overloaded')
    })

    // The engine codes it `provider_context_window`, but what reaches the chat is the provider's
    // sentence. It used to fall through to `generic` and get offered a retry that hits the same wall.
    it('recognises a conversation that no longer fits the model', () => {
        expect(classifyChatError('AI_APICallError: prompt is too long: 213456 tokens > 200000 maximum')).toBe('context_window')
        expect(classifyChatError('Error: This request exceeds the context window of the model.')).toBe('context_window')
        expect(friendlyError('AI_APICallError: prompt is too long: 213456 tokens > 200000 maximum')).toContain('larger context window')
    })

    it('tells a model at capacity apart from an overloaded provider', () => {
        expect(friendlyError('Error: Selected model is at capacity. Please try a different model.')).toBe('This model has no room right now. Try again in a moment or pick another model.')
        expect(friendlyError('Error: exceeded retry limit, last status: 429 Too Many Requests')).toBe('The provider is overloaded right now. Try again in a moment.')
    })

    it('recognises a run a restart cut short', () => {
        expect(classifyChatError('interrupted: engine restarted')).toBe('interrupted')
    })

    it('recognises a run whose Claude sign-in the engine renewed under it', () => {
        expect(classifyChatError('ClaudeSignInRenewedError: interrupted: Claude sign-in renewed during the run')).toBe('interrupted')
        expect(friendlyError('ClaudeSignInRenewedError: interrupted: Claude sign-in renewed during the run')).toContain('cut off')
    })

    it('recognises the conversation the engine refused to take a second run on', () => {
        expect(classifyChatError('run_in_flight')).toBe('run_in_flight')
    })

    it('leaves anything it does not know as generic', () => {
        expect(classifyChatError('Error: ECONNRESET')).toBe('generic')
        expect(classifyChatError('')).toBe('generic')
    })
})

describe('friendlyError, beyond the budget', () => {
    it('replaces a classified provider stack with something actionable', () => {
        expect(friendlyError('Error: Claude AI usage limit reached|1750000000')).toContain('Your Claude plan')
        expect(friendlyError('interrupted: engine restarted')).toContain('cut off')
    })

    it('passes an unrecognised message through, minus the class name', () => {
        expect(friendlyError('Error: ECONNRESET')).toBe('ECONNRESET')
    })
})

describe('describeSubscriptionLimit', () => {
    it('names the claude window that ran out', () => {
        expect(describeSubscriptionLimit("You've hit your session limit · resets 3pm")).toEqual({ plan: 'claude', scope: 'session', resetsAt: '3pm' })
        expect(describeSubscriptionLimit("You've hit your weekly limit")).toEqual({ plan: 'claude', scope: 'weekly' })
        expect(describeSubscriptionLimit("You've hit your Opus limit")).toEqual({ plan: 'claude', scope: 'model', modelName: 'Opus' })
    })

    // codex throws its server's message away and keeps only the raw finish reason, which is exactly
    // what tells the two CLIs apart: claude-code never emits that marker.
    it('reads a bare codex finish reason as the ChatGPT plan', () => {
        expect(describeSubscriptionLimit('Error: usage_limit_exceeded')).toEqual({ plan: 'chatgpt', scope: 'session' })
    })

    // The sentences real boxes failed on, none of which the chat used to name.
    it('names a model the plan does not include', () => {
        expect(describeSubscriptionLimit('AI_APICallError: Fable 5.1 requires usage credits. Switch to another model to continue.')).toEqual({ plan: 'claude', scope: 'not_in_plan', modelName: 'Fable 5.1' })
        expect(describeSubscriptionLimit('Error: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6-astra\' model is not supported when using Codex with a ChatGPT account."}}')).toEqual({
            plan: 'chatgpt',
            scope: 'not_in_plan',
            modelName: 'GPT-6 Astra',
        })
    })

    it('tells spent credits and an organization cap apart from a usage window', () => {
        expect(describeSubscriptionLimit("AI_APICallError: You're out of usage credits. Switch to another model to continue.")).toEqual({ plan: 'claude', scope: 'credits' })
        expect(describeSubscriptionLimit("AI_APICallError: You've hit your org's monthly spend limit · ask your admin to raise it · your session limit resets 3pm")).toEqual({ plan: 'claude', scope: 'spend' })
    })

    it('keeps the time the plan refills', () => {
        expect(describeSubscriptionLimit("AI_APICallError: You've hit your weekly limit · resets Oct 12, 3am (UTC)")).toEqual({ plan: 'claude', scope: 'weekly', resetsAt: 'Oct 12, 3am (UTC)' })
        expect(describeSubscriptionLimit("Error: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 4:44 PM.")).toEqual({
            plan: 'chatgpt',
            scope: 'session',
            resetsAt: '4:44 PM',
        })
        expect(friendlyError("AI_APICallError: You've hit your session limit · resets 6:50pm (UTC)")).toContain('It refills at 6:50pm (UTC)')
    })

    it('falls back to a plan-less description when nothing names a vendor', () => {
        expect(describeSubscriptionLimit('Error: quota exceeded')).toEqual({ plan: null, scope: 'session' })
    })

    it('says whose plan is out rather than "this subscription"', () => {
        expect(friendlyError("AI_APICallError: You've hit your session limit · resets 3pm")).toContain('Your Claude plan')
        expect(friendlyError('Error: usage_limit_exceeded')).toContain('Your ChatGPT plan')
    })
})

// The engine rewrites OpenCode's refusals into these sentences: OpenCode's own say neither which plan
// nor which window ran out.
describe('OpenCode limits', () => {
    const credits = 'AI_APICallError: OpenCode Console credits used up: Insufficient account funds'
    const goWeekly = 'AI_APICallError: OpenCode Go limit reached: weekly window · resets Nov 6, 3:00 PM UTC'

    it('reads as a usage limit, never as the Rerun budget, and names OpenCode', () => {
        expect(classifyChatError(credits)).toBe('usage_limit')
        expect(classifyChatError(goWeekly)).toBe('usage_limit')
        expect(chatErrorTitle('usage_limit', credits)).toBe('OpenCode credits used up')
        expect(friendlyError(credits)).toBe('No Console credits left. Add credits on opencode.ai, or pick a Go model to keep going.')
    })

    // A Console model is often a Claude: the OpenCode rule runs before the "claude" one.
    it('names OpenCode on a Console Claude model', () => {
        const onClaude = `${credits} (console/claude-sonnet-5-5)`
        expect(describeSubscriptionLimit(onClaude)).toEqual({ plan: 'opencode', scope: 'credits' })
        expect(friendlyError(onClaude)).not.toContain('Claude plan')
    })

    it('names the Go window that ran out, and when it comes back', () => {
        expect(describeSubscriptionLimit(goWeekly)).toEqual({ plan: 'opencode', scope: 'weekly', resetsAt: 'Nov 6, 3:00 PM UTC' })
        expect(chatErrorTitle('usage_limit', goWeekly)).toBe('OpenCode Go weekly limit reached')
        expect(friendlyError(goWeekly)).toContain('reached its weekly limit. It resets Nov 6, 3:00 PM UTC')
        expect(describeSubscriptionLimit('OpenCode Go limit reached: monthly window')).toEqual({ plan: 'opencode', scope: 'monthly' })
        expect(friendlyError('OpenCode Go limit reached: 5-hour window')).toContain('its 5-hour limit')
    })
})

describe('chatErrorTitle', () => {
    const titleOf = (message: string) => chatErrorTitle(classifyChatError(message), message)

    it('names an expired OAuth token as a signed-out connection', () => {
        expect(titleOf('AI_LoadAPIKeyError: Failed to authenticate. API Error: 401 OAuth access token has expired.')).toBe('Connection signed out')
    })

    it('names the plan and window of a spent subscription', () => {
        expect(titleOf("AI_APICallError: You've hit your session limit · resets 3pm")).toBe('Claude session limit reached')
    })

    it('names the model a plan does not include', () => {
        expect(titleOf('AI_APICallError: Fable 5.1 requires usage credits. Switch to another model to continue.')).toBe("Fable 5.1 isn't in your Claude plan")
    })

    it('says the model could not answer when its provider refused the request', () => {
        expect(titleOf('AI_APICallError: Provider returned error')).toBe('The model could not answer')
    })

    it('says the model is at capacity rather than the whole provider overloaded', () => {
        expect(titleOf('Error: Selected model is at capacity. Please try a different model.')).toBe('Model at capacity')
        expect(titleOf('Error: exceeded retry limit, last status: 429 Too Many Requests')).toBe('Provider overloaded')
    })

    it('names a conversation that outgrew the model', () => {
        expect(titleOf('AI_APICallError: prompt is too long: 213456 tokens > 200000 maximum')).toBe('Conversation too long')
    })

    it('gives a generic error no headline of its own', () => {
        expect(titleOf('AI_APICallError: Connection closed by the provider before the turn started.')).toBeNull()
    })
})

describe('teammateRunOf', () => {
    it('names the run a teammate holds the conversation with', () => {
        expect(teammateRunOf('{"error":"run_in_flight","runId":"r1","startedAt":null,"heldByTeammate":true}')).toEqual({ runId: 'r1' })
    })

    it('is null for a run this person started, and for anything that is not that refusal', () => {
        expect(teammateRunOf('{"error":"run_in_flight","runId":"r1","heldByTeammate":false}')).toBeNull()
        expect(teammateRunOf('Failed to fetch')).toBeNull()
    })
})

describe('installInFlightOf', () => {
    it('names the conversation the install already runs in', () => {
        expect(installInFlightOf('{"error":"install_in_flight","sessionId":"s1"}')).toEqual({ sessionId: 's1' })
    })

    it('is null for any other refusal', () => {
        expect(installInFlightOf('{"error":"run_in_flight","runId":"r1"}')).toBeNull()
        expect(installInFlightOf('{"error":"install_in_flight","sessionId":null}')).toBeNull()
        expect(installInFlightOf('Failed to fetch')).toBeNull()
    })
})

describe('a conversation the coworker cannot reach', () => {
    it('is classified from the hub code and from the engine sentence', () => {
        expect(classifyChatError(unwrapChatError('{"error":"session_not_found"}'))).toBe('session_gone')
        expect(classifyChatError('Engine error: 404 {"error":"session not found for this agent"}')).toBe('session_gone')
    })

    it('says what happened instead of quoting the engine', () => {
        const message = unwrapChatError('{"error":"session_not_found"}')
        expect(chatErrorTitle('session_gone', message)).toBe('Conversation unavailable')
        expect(friendlyError(message)).toMatch(/Start a new conversation/)
    })
})

// Every sentence as it read before it moved to the catalog: the English must not change.
describe('the English copy of a spent subscription', () => {
    const cases: [SubscriptionLimit, string, string][] = [
        [{ plan: 'opencode', scope: 'credits' }, 'OpenCode credits used up', 'No Console credits left. Add credits on opencode.ai, or pick a Go model to keep going.'],
        [{ plan: 'opencode', scope: 'monthly', resetsAt: 'Dec 1' }, 'OpenCode Go monthly limit reached', 'Your OpenCode Go plan has reached its monthly limit. It resets Dec 1; switch to a Console model or another provider until then.'],
        [{ plan: 'opencode', scope: 'session' }, 'OpenCode Go limit reached', 'Your OpenCode Go plan has reached its 5-hour limit. Switch to a Console model or another provider until it resets.'],
        [{ plan: null, scope: 'not_in_plan', modelName: 'GPT-6' }, 'GPT-6 unavailable', "This connection can't run GPT-6. Pick another model to keep going."],
        [{ plan: null, scope: 'not_in_plan' }, 'Model unavailable', "This connection can't run this model. Pick another model to keep going."],
        [{ plan: 'claude', scope: 'not_in_plan', modelName: 'Fable 5.1' }, "Fable 5.1 isn't in your Claude plan", "Your Claude plan doesn't include Fable 5.1. Pick another model to keep going."],
        [{ plan: 'chatgpt', scope: 'not_in_plan' }, 'Model not in your ChatGPT plan', "Your ChatGPT plan doesn't include this model. Pick another model to keep going."],
        [{ plan: null, scope: 'session' }, 'Usage limit reached', 'This subscription has reached its usage limit. Switch to another model, or wait for the limit to reset.'],
        [{ plan: 'claude', scope: 'credits' }, 'Claude usage credits used up', 'Your Claude plan has used up its usage credits. Pick a model your plan includes to keep going.'],
        [{ plan: 'claude', scope: 'spend' }, 'Claude spend limit reached', 'Your organization has reached its monthly Claude spend limit. An admin can raise it; switch this coworker to another model in the meantime.'],
        [{ plan: 'claude', scope: 'weekly', resetsAt: 'Oct 12, 3am (UTC)' }, 'Claude weekly limit reached', 'Your Claude plan has reached its weekly limit. It resets Oct 12, 3am (UTC); switch this coworker to another model until then.'],
        [{ plan: 'claude', scope: 'weekly' }, 'Claude weekly limit reached', 'Your Claude plan has reached its weekly limit. Switch this coworker to another model until the week rolls over.'],
        [{ plan: 'claude', scope: 'model', modelName: 'Opus' }, 'Claude Opus limit reached', 'Your Claude plan has reached its Opus limit. The other Claude models still run: switch to one of them.'],
        [{ plan: 'claude', scope: 'session', resetsAt: '3pm' }, 'Claude session limit reached', 'Your Claude plan has used up its current usage window. It refills at 3pm; switch this coworker to another model in the meantime.'],
        [{ plan: 'chatgpt', scope: 'session' }, 'ChatGPT usage limit reached', 'Your ChatGPT plan has used up its current usage window. It refills on its own; switch this coworker to another model in the meantime.'],
    ]

    it.each(cases)('%o', (limit, title, message) => {
        expect(subscriptionLimitTitle(limit, english)).toBe(title)
        expect(subscriptionLimitMessage(limit, english)).toBe(message)
    })

    it('keeps the fixed sentences', () => {
        expect(friendlyError('rerun_budget_exhausted')).toBe('Rerun credits used up for this period. Add credits or wait for the monthly reset.')
        expect(chatErrorTitle('run_in_flight', 'A run is already in flight')).toBe('This conversation is still busy')
        expect(chatErrorTitle('unauthorized', '401')).toBe('Connection signed out')
        expect(chatErrorTitle('overloaded', 'Selected model is at capacity')).toBe('Model at capacity')
    })
})

describe('in the reader\'s language', () => {
    it('translates what it explains and keeps the provider\'s own words otherwise', () => {
        expect(titleIn('usage_limit', "You've hit your weekly limit", french)).toBe('Limite hebdomadaire Claude atteinte')
        expect(friendlyIn("AI_APICallError: You've hit your session limit · resets 6:50pm (UTC)", french)).toContain('Elle se recharge à 6:50pm (UTC)')
        expect(friendlyIn('', french)).toBe('Une erreur est survenue. Essayez de renvoyer votre message.')
        expect(friendlyIn('Error: ECONNRESET', french)).toBe('ECONNRESET')
    })
})
