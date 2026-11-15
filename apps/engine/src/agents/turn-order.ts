import { opencodeUpstreamId, type Provider } from '@rerun/contracts'

export type TurnOrder = 'message-first' | 'call-first'

const ENDS_ON_ITS_MESSAGE = /^(openai\/)?(gpt-|o\d)/i
const NOTES_BEFORE_A_CALL_ARE_FOLDED = /^(anthropic\/)?claude-/i
const CLAUDE_PROVIDERS: ReadonlySet<Provider> = new Set(['claude', 'anthropic'])

export function turnOrder(provider: Provider, model: string): TurnOrder {
    const id = provider === 'opencode' ? opencodeUpstreamId(model) : model
    if (provider === 'codex' || CLAUDE_PROVIDERS.has(provider)) return 'call-first'
    return ENDS_ON_ITS_MESSAGE.test(id) || NOTES_BEFORE_A_CALL_ARE_FOLDED.test(id) ? 'call-first' : 'message-first'
}

export function cardCallTiming(order: TurnOrder): string {
    return order === 'call-first'
        ? 'Call it before writing your message, which then ends your turn: the card still shows below that message.'
        : 'Call it in the same reply as your message, right after it: a reply that stops at the message never sends the card.'
}
