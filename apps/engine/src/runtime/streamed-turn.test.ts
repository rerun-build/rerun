import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { streamedTurn } from './streamed-turn.js'

describe('streamedTurn', () => {
    it('gives nothing when nothing was streamed', () => {
        expect(streamedTurn().messages()).toEqual([])
    })

    it('joins the deltas of one text and keeps a new text apart', () => {
        const turn = streamedTurn()
        turn.add({ type: 'reasoning-delta', id: 'r', text: 'Plan ' })
        turn.add({ type: 'reasoning-delta', id: 'r', text: 'first.' })
        turn.add({ type: 'text-delta', id: 'a', text: 'Writing ' })
        turn.add({ type: 'text-delta', id: 'a', text: 'the report.' })
        turn.add({ type: 'text-delta', id: 'b', text: 'Done.' })

        expect(turn.messages()).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'reasoning', text: 'Plan first.' },
                    { type: 'text', text: 'Writing the report.' },
                    { type: 'text', text: 'Done.' },
                ],
            },
        ])
    })

    it('keeps a result the provider ran beside its call, and one the engine ran in a tool message', () => {
        const turn = streamedTurn()
        turn.add({ type: 'tool-call', toolCallId: 'c1', toolName: 'mcp__rerun__fs_write', input: { path: 'a.md' }, providerExecuted: true })
        turn.add({ type: 'tool-result', toolCallId: 'c1', toolName: 'mcp__rerun__fs_write', input: { path: 'a.md' }, output: { written: true }, providerExecuted: true })
        turn.add({ type: 'tool-call', toolCallId: 'c2', toolName: 'fs_list', input: {} })
        turn.add({ type: 'tool-result', toolCallId: 'c2', toolName: 'fs_list', input: {}, output: 'a.md' })

        expect(turn.messages()).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'tool-call', toolCallId: 'c1', toolName: 'mcp__rerun__fs_write', input: { path: 'a.md' }, providerExecuted: true },
                    { type: 'tool-result', toolCallId: 'c1', toolName: 'mcp__rerun__fs_write', output: { type: 'json', value: { written: true } } },
                    { type: 'tool-call', toolCallId: 'c2', toolName: 'fs_list', input: {} },
                ],
            },
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c2', toolName: 'fs_list', output: { type: 'text', value: 'a.md' } }] },
        ])
    })

    it('drops a step that only reasoned', () => {
        const turn = streamedTurn()
        turn.add({ type: 'reasoning-delta', id: 'r', text: 'Thinking it through.' })

        expect(turn.messages()).toEqual([])
    })

    it('skips preliminary results', () => {
        const turn = streamedTurn()
        turn.add({ type: 'tool-call', toolCallId: 'c1', toolName: 'delegate', input: {} })
        turn.add({ type: 'tool-result', toolCallId: 'c1', toolName: 'delegate', input: {}, output: 'half', preliminary: true })

        expect(turn.messages()).toEqual([{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'delegate', input: {} }] }])
    })

    it('takes the finished steps from the SDK and only rebuilds the step still running', () => {
        const turn = streamedTurn()
        turn.add({ type: 'text-delta', id: 'a', text: 'step one, as streamed' })
        const finished: ModelMessage[] = [{ role: 'assistant', content: [{ type: 'text', text: 'step one' }] }]
        turn.stepFinished(finished)
        turn.add({ type: 'text-delta', id: 'a', text: 'step two' })

        expect(turn.messages()).toEqual([...finished, { role: 'assistant', content: [{ type: 'text', text: 'step two' }] }])
    })
})
