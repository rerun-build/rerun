import type { ModelMessage } from 'ai'
import { contextTextPart } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { stoppedCallResult, stoppedTurn, stoppedTurnNote } from './stopped-turn.js'

const text = (value: string) => ({ type: 'text' as const, text: value })
const call = (toolCallId: string, toolName: string, providerExecuted?: boolean) => ({ type: 'tool-call' as const, toolCallId, toolName, input: {}, ...(providerExecuted ? { providerExecuted } : {}) })
const result = (toolCallId: string, toolName: string) => ({ type: 'tool-result' as const, toolCallId, toolName, output: { type: 'text' as const, value: 'ok' } })
const stopped = (toolCallId: string, toolName: string) => ({ ...result(toolCallId, toolName), output: { type: 'error-text' as const, value: stoppedCallResult('the user') } })
const note = contextTextPart(stoppedTurnNote('the user'))

describe('stoppedTurn', () => {
    it('keeps nothing of a turn that had not started', () => {
        expect(stoppedTurn([], 'the user')).toEqual([])
    })

    it('closes the last message with the note', () => {
        expect(stoppedTurn([{ role: 'assistant', content: [text('Reading.')] }], 'the user')).toEqual([{ role: 'assistant', content: [text('Reading.'), note] }])
    })

    it('puts the result of a tool the CLI ran in a tool message, and answers the call it was cut on', () => {
        expect(stoppedTurn([{ role: 'assistant', content: [text('Step 1.'), call('c1', 'Bash', true), result('c1', 'Bash'), text('Step 2.'), call('c2', 'Bash', true)] }], 'the user')).toEqual([
            { role: 'assistant', content: [text('Step 1.'), call('c1', 'Bash')] },
            { role: 'tool', content: [result('c1', 'Bash')] },
            { role: 'assistant', content: [text('Step 2.'), call('c2', 'Bash')] },
            { role: 'tool', content: [stopped('c2', 'Bash')] },
            { role: 'assistant', content: [note] },
        ])
    })

    it('answers a call Rerun was running in a tool message of its own', () => {
        expect(stoppedTurn([{ role: 'assistant', content: [call('c1', 'web_fetch')] }], 'the user')).toEqual([
            { role: 'assistant', content: [call('c1', 'web_fetch')] },
            { role: 'tool', content: [stopped('c1', 'web_fetch')] },
            { role: 'assistant', content: [note] },
        ])
    })

    it('joins the results that came before the stop', () => {
        const turn: ModelMessage[] = [
            { role: 'assistant', content: [call('c1', 'web_fetch'), call('c2', 'web_search')] },
            { role: 'tool', content: [result('c1', 'web_fetch')] },
        ]
        expect(stoppedTurn(turn, 'the user')).toEqual([turn[0], { role: 'tool', content: [result('c1', 'web_fetch'), stopped('c2', 'web_search')] }, { role: 'assistant', content: [note] }])
    })

    it('drops the card with its result, and the message left with nothing to say', () => {
        expect(
            stoppedTurn(
                [
                    { role: 'assistant', content: [{ type: 'reasoning', text: 'Ask.' }, call('q1', 'mcp__rerun__ask_user')] },
                    { role: 'tool', content: [result('q1', 'mcp__rerun__ask_user')] },
                ],
                'the user'
            )
        ).toEqual([])
    })

    it('keeps the finished steps in their order', () => {
        const steps: ModelMessage[] = [
            { role: 'assistant', content: [call('c1', 'web_fetch')] },
            { role: 'tool', content: [result('c1', 'web_fetch')] },
            { role: 'assistant', content: [text('Half of it.')] },
        ]
        expect(stoppedTurn(steps, 'the user')).toEqual([steps[0], steps[1], { role: 'assistant', content: [text('Half of it.'), note] }])
    })
})
