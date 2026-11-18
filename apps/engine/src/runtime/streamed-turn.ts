import type { AssistantContent, ModelMessage, TextStreamPart, ToolResultPart, ToolSet } from 'ai'

type AssistantPart = Exclude<AssistantContent, string>[number]
type StreamedChunk = Extract<TextStreamPart<ToolSet>, { type: 'text-delta' | 'reasoning-delta' | 'tool-call' | 'tool-result' }> | { type: string }

function modelOutput(output: unknown): ToolResultPart['output'] {
    return typeof output === 'string' ? { type: 'text', value: output } : { type: 'json', value: (output ?? null) as never }
}

// The SDK only hands a step's messages over once the step is finished, and a Claude Code turn is a
// single step that a spent plan ends with a thrown error: what that turn already did has to be
// rebuilt from the chunks, or the model that takes the turn over starts it from scratch.
export function streamedTurn() {
    let finishedSteps: ModelMessage[] = []
    let assistant: AssistantPart[] = []
    let toolResults: ToolResultPart[] = []
    let openDelta: { type: 'text' | 'reasoning'; id: string } | null = null

    const appendDelta = (type: 'text' | 'reasoning', id: string, text: string) => {
        const last = assistant.at(-1)
        if (openDelta?.type === type && openDelta.id === id && last?.type === type) {
            assistant[assistant.length - 1] = { ...last, text: last.text + text }
            return
        }
        openDelta = { type, id }
        assistant.push({ type, text })
    }

    return {
        add(chunk: StreamedChunk): void {
            if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
                const delta = chunk as Extract<StreamedChunk, { type: 'text-delta' | 'reasoning-delta' }>
                if (delta.text) appendDelta(delta.type === 'text-delta' ? 'text' : 'reasoning', delta.id, delta.text)
                return
            }
            openDelta = null
            if (chunk.type === 'tool-call') {
                const call = chunk as Extract<TextStreamPart<ToolSet>, { type: 'tool-call' }>
                assistant.push({ type: 'tool-call', toolCallId: call.toolCallId, toolName: call.toolName, input: call.input, ...(call.providerExecuted ? { providerExecuted: true } : {}) })
            } else if (chunk.type === 'tool-result') {
                const result = chunk as Extract<TextStreamPart<ToolSet>, { type: 'tool-result' }>
                if (result.preliminary) return
                const part: ToolResultPart = { type: 'tool-result', toolCallId: result.toolCallId, toolName: result.toolName, output: modelOutput(result.output) }
                if (result.providerExecuted) assistant.push(part)
                else toolResults.push(part)
            }
        },
        // `step.response.messages` holds every step so far, not only the one that just finished.
        stepFinished(messages: ModelMessage[]): void {
            finishedSteps = messages
            assistant = []
            toolResults = []
            openDelta = null
        },
        messages(): ModelMessage[] {
            const current: ModelMessage[] = []
            // Streamed reasoning carries no signature, so the history drops it on replay: a step that
            // only reasoned would come back as an assistant message with nothing in it.
            if (assistant.some(part => part.type !== 'reasoning')) current.push({ role: 'assistant', content: [...assistant] })
            if (toolResults.length) current.push({ role: 'tool', content: [...toolResults] })
            return [...finishedSteps, ...current]
        },
    }
}
