import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText, tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { HITL_ACK, hitlStepLacksMessage, hitlTurnIsOver } from '../tools/builtin/hitl.js'
import { reasoningProviderOptions } from './reasoning.js'

type SentBody = {
    tools?: { name: string }[]
    tool_choice?: { type: string }
    messages: { role: string; content: string | { type: string; signature?: string }[] }[]
}

const sse = (events: object[]) => events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('')

const messageStart = { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }
const messageEnd = (stopReason: string) => [
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
]

const bareCardTurn = sse([
    messageStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I need their Netlify token first.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-against-the-full-tool-list' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'ask_user', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"question":"Which Netlify token?"}' } },
    { type: 'content_block_stop', index: 1 },
    ...messageEnd('tool_use'),
])

const messageTurn = sse([
    messageStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I need your Netlify token, the card below asks for it.' } },
    { type: 'content_block_stop', index: 0 },
    ...messageEnd('end_turn'),
])

// Anthropic binds a signed thinking block to the tool list it was produced with. The step that
// writes the message of a bare card runs with `toolChoice: 'none'`: if the provider drops `tools`
// from that request instead of sending `tool_choice: none`, the replayed block is refused with
// "Invalid signature in thinking block ... The tools list differs".
describe('the Anthropic request of the step that writes a bare card its message', () => {
    it('keeps the tool list and sends tool_choice none, with the signed thinking replayed', async () => {
        const sent: SentBody[] = []
        const turns = [bareCardTurn, messageTurn]
        const anthropic = createAnthropic({
            apiKey: 'test',
            fetch: async (_input, init) => {
                sent.push(JSON.parse(String(init?.body)) as SentBody)
                return new Response(turns[sent.length - 1], { headers: { 'content-type': 'text/event-stream' } })
            },
        })

        const result = streamText({
            model: anthropic('claude-sonnet-5-5'),
            prompt: 'Deploy my pages on Netlify.',
            providerOptions: reasoningProviderOptions('anthropic'),
            tools: {
                lookup_service: tool({ description: 'Look up a service.', inputSchema: z.object({ name: z.string() }), execute: async ({ name }) => ({ name }) }),
                ask_user: tool({ description: 'Ask the user.', inputSchema: z.object({ question: z.string() }), execute: async () => HITL_ACK }),
            },
            stopWhen: ({ steps }) => hitlTurnIsOver(steps, false),
            prepareStep: ({ steps }) => (hitlStepLacksMessage(steps) ? { toolChoice: 'none' as const } : {}),
        })
        await result.consumeStream()

        expect(sent).toHaveLength(2)
        const [cardStep, messageStep] = sent
        expect(messageStep.tools?.map(t => t.name)).toEqual(cardStep.tools?.map(t => t.name))
        expect(messageStep.tool_choice).toEqual({ type: 'none' })
        const replayed = messageStep.messages.flatMap(m => (Array.isArray(m.content) ? m.content : [])).filter(part => part.type === 'thinking')
        expect(replayed).toEqual([expect.objectContaining({ signature: 'signed-against-the-full-tool-list' })])
        expect(await result.text).toBe('I need your Netlify token, the card below asks for it.')
    })
})
