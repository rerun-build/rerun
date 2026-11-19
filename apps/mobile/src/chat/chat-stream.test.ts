import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage, type UIMessageChunk } from 'ai'

import stream from '../../api-contract/chat-stream.json'

// The stream of a chat as the engine sends it (written by apps/engine/src/runtime/chat-stream.contract.test.ts),
// read the way the chat transport reads it: every chunk through the AI SDK's own schema, then built into
// the message the conversation shows.
function sse(chunks: unknown[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
        },
    })
}

async function readChunks(): Promise<UIMessageChunk[]> {
    const chunks: UIMessageChunk[] = []
    const reader = parseJsonEventStream({ stream: sse(stream.chunks), schema: uiMessageChunkSchema }).getReader()
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
        if (!next.value.success) throw new Error(`The app cannot read ${JSON.stringify(next.value.rawValue)}: ${next.value.error.message}`)
        chunks.push(next.value.value)
    }
    return chunks
}

describe('the stream of a chat', () => {
    it('reads every chunk the engine sends', async () => {
        expect(await readChunks()).toHaveLength(stream.chunks.length)
    })

    it('builds the message the conversation shows', async () => {
        const chunks = await readChunks()
        let message: UIMessage | undefined
        const source = new ReadableStream<UIMessageChunk>({ start: controller => (chunks.forEach(chunk => controller.enqueue(chunk)), controller.close()) })
        for await (const state of readUIMessageStream({ stream: source, terminateOnError: true })) message = state
        const parts = message?.parts ?? []
        expect(parts.filter(part => part.type === 'text').map(part => (part as { text: string }).text)).toEqual(['Looking for leads in Lyon.', 'Found Maison Nord. The email did not go out.'])
        expect(parts.some(part => part.type === 'reasoning')).toBe(true)
        expect(parts.find(part => part.type === 'tool-find_leads')).toMatchObject({ state: 'output-available', output: { leads: [{ name: 'Maison Nord' }] } })
        expect(parts.find(part => part.type === 'tool-send_email')).toMatchObject({ state: 'output-error', errorText: 'The mailbox refused the address' })
        expect(parts.find(part => part.type === 'data-delegate')).toBeDefined()
    })
})
