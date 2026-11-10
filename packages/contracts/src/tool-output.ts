const TOOL_OUTPUT_ENVELOPES = new Set(['json', 'text', 'error-json', 'error-text'])

// A tool result reloaded from the engine's history is an AI-SDK `ModelMessage` part, so the payload
// sits behind a `{ type: 'json' | 'text', value }` envelope that the live stream does not have.
// Without this, nothing rendered from a tool output survives a page reload.
export function unwrapToolOutputEnvelope(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const envelope = value as { type?: unknown; value?: unknown }
    if (typeof envelope.type !== 'string' || !TOOL_OUTPUT_ENVELOPES.has(envelope.type) || !('value' in envelope)) return value
    return envelope.value
}

// The engine returns an MCP tool result to the AI SDK as `JSON.stringify(result.content)`,
// i.e. the chat `output` is a JSON string of `[{ type: 'text', text: '<our-json>' }]`.
// This unwraps all the shapes we might see (envelope, raw string, content array, or a plain
// object) back into the structured payload the tool returned.
export function parseHubOutput<T = unknown>(output: unknown): T | null {
    let value: unknown = unwrapToolOutputEnvelope(output)

    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch {
            return null
        }
    }

    if (Array.isArray(value)) {
        const textItem = value.find(it => it && typeof it === 'object' && (it as { type?: unknown }).type === 'text' && typeof (it as { text?: unknown }).text === 'string')
        if (!textItem) return null
        try {
            value = JSON.parse((textItem as { text: string }).text)
        } catch {
            return null
        }
    }

    if (value && typeof value === 'object' && 'structuredContent' in (value as Record<string, unknown>)) {
        value = (value as { structuredContent: unknown }).structuredContent
    }

    return (value ?? null) as T | null
}

const UNKNOWN_TOOL_ERROR = /No such tool available|tried to call unavailable tool/
const CLI_TOOL_ERROR_TAG = /<\/?tool_use_error>/g

export type ToolErrorCopy = (key: 'errors.notFound') => string

// The CLI wraps a tool error in `<tool_use_error>`, and a call to a name the model got wrong comes
// back as a sentence meant for the model (the AI SDK one lists every tool of the run). The model
// needs them as they are; the person reading the chat does not.
export function readableToolError(errorText: string, t: ToolErrorCopy): string {
    if (UNKNOWN_TOOL_ERROR.test(errorText)) return t('errors.notFound')
    return errorText.replace(CLI_TOOL_ERROR_TAG, '').trim()
}
