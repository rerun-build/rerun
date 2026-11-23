import type { ModelMessage } from 'ai'

/**
 * A past turn carries its reasoning in the row, but replaying it buys nothing, and a turn cut short
 * persists a thought with no signature, which the provider drops with a warning.
 *
 * Within a run the model reads its own thoughts again at each step, except on Anthropic once what
 * came before them changed (a summary, a screenshot that left): it signs a thought with all of that
 * and refuses it (RER-278).
 *
 * The rest of an OpenAI step loses its item ids with the thought: `@ai-sdk/openai` replays a part
 * that has one as a reference to the item OpenAI stored, and OpenAI refuses a call or a message
 * referenced without the reasoning item that came before it (RER-138).
 */
export function withoutReasoning(message: ModelMessage): ModelMessage {
    if (!Array.isArray(message.content)) return message
    const content = message.content.filter(part => part.type !== 'reasoning')
    if (content.length === message.content.length) return message
    return { ...message, content: content.map(part => withoutOpenAiItemId(part)) } as ModelMessage
}

type PartWithOptions = { providerOptions?: Record<string, Record<string, unknown>> }

function withoutOpenAiItemId<Part extends object>(part: Part): Part {
    const options = (part as PartWithOptions).providerOptions
    if (!options?.openai || !('itemId' in options.openai)) return part
    const { openai: { itemId: _itemId, ...keptOpenai }, ...otherProviders } = options
    const providerOptions = Object.keys(keptOpenai).length ? { ...otherProviders, openai: keptOpenai } : otherProviders
    if (Object.keys(providerOptions).length) return { ...part, providerOptions }
    const { providerOptions: _dropped, ...bare } = part as Part & PartWithOptions
    return bare as Part
}
