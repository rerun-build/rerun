import { opencodeUpstreamId, type Provider } from '@rerun/contracts'

export type TurnOrder = 'message-first' | 'call-first'

// Two families end their turn on the calls, for two different reasons. A GPT model ends its reply
// on the message it writes, on Codex as on any API: a call meant to come after the message is often
// never made (3 turns in 9 on GPT-6 Sol announced a card they never sent). On a Claude from Opus 5.5,
// Sonnet 5.5 and Fable on, a note longer than a sentence or two written right before a tool call
// comes back from the API as a progress-update `thinking` block, which the chat folds into the
// steps: the message written before a card never reached the user. The text that ends a turn
// precedes no call and stays text, hence calls first for every Claude rather than a version list
// that would age. Every other model writes its message, then makes the calls that close the turn.
const ENDS_ON_ITS_MESSAGE = /^(openai\/)?(gpt-|o\d)/i
const NOTES_BEFORE_A_CALL_ARE_FOLDED = /^(anthropic\/)?claude-/i
const CLAUDE_PROVIDERS: ReadonlySet<Provider> = new Set(['claude', 'anthropic'])

// `model` is the one that answers: behind a Rerun alias, the model the hub serves it with. An OpenCode
// id is read without its plan (`go/gpt-6-luna`).
export function turnOrder(provider: Provider, model: string): TurnOrder {
    const id = provider === 'opencode' ? opencodeUpstreamId(model) : model
    if (provider === 'codex' || CLAUDE_PROVIDERS.has(provider)) return 'call-first'
    return ENDS_ON_ITS_MESSAGE.test(id) || NOTES_BEFORE_A_CALL_ARE_FOLDED.test(id) ? 'call-first' : 'message-first'
}

// Repeated on each card that closes a turn: a model on an API provider reads a tool's own text more
// closely than the prompt, and without it ends its reply on the message that announces the card.
export function cardCallTiming(order: TurnOrder): string {
    return order === 'call-first'
        ? 'Call it before writing your message, which then ends your turn: the card still shows below that message.'
        : 'Call it in the same reply as your message, right after it: a reply that stops at the message never sends the card.'
}
