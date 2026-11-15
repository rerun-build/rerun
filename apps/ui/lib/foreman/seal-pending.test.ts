import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { sealPendingWidgets, withTypedAnswer } from './seal-pending'

const message = (parts: unknown[]): UIMessage => ({ id: 'm1', role: 'assistant', parts }) as UIMessage

describe('sealPendingWidgets', () => {
    it('closes a question nobody answered as abandoned', () => {
        const sealed = sealPendingWidgets([message([{ type: 'tool-ask_choice', toolCallId: 'c1', state: 'input-available', input: { question: 'Which one?' } }])])
        expect(sealed[0].parts[0]).toMatchObject({ state: 'output-available', output: { answered: false, reason: 'abandoned' } })
    })

    it('says why the question closed when the caller knows', () => {
        const sealed = sealPendingWidgets([message([{ type: 'tool-ask_either', toolCallId: 'c1', state: 'input-available', input: { title: 'Which one?' } }])], 'dismissed')
        expect(sealed[0].parts[0]).toMatchObject({ output: { answered: false, reason: 'dismissed' } })
    })

    it('closes an abandoned checkout in the shape the checkout speaks', () => {
        const sealed = sealPendingWidgets([message([{ type: 'tool-open_checkout', toolCallId: 'c1', state: 'input-available', input: {} }])])
        expect(sealed[0].parts[0]).toMatchObject({ state: 'output-available', output: { ok: false, reason: 'dismissed' } })
    })

    it('leaves an answered question, and every other tool, alone', () => {
        const original = [
            message([
                { type: 'tool-ask_input', toolCallId: 'c1', state: 'output-available', output: { answered: true, answers: ['rerun.build'] } },
                { type: 'tool-create_agent', toolCallId: 'c2', state: 'input-available', input: {} },
                { type: 'tool-delete_agent', toolCallId: 'c3', state: 'approval-requested', input: {} },
            ]),
        ]
        expect(sealPendingWidgets(original)).toBe(original)
    })
})

describe('withTypedAnswer', () => {
    it('closes the question and adds the message typed over it in the same transcript', () => {
        const typed = withTypedAnswer([message([{ type: 'tool-ask_choice', toolCallId: 'c1', state: 'input-available', input: { question: 'Which one?' } }])], 'Neither')

        expect(typed).toHaveLength(2)
        expect(typed[0].parts[0]).toMatchObject({ state: 'output-available', output: { answered: false, reason: 'typed' } })
        expect(typed[1]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'Neither' }] })
        expect(typed[1].id).toBeTruthy()
    })

    it('adds the message alone when nothing is waiting', () => {
        const original = [message([{ type: 'text', text: 'Hi' }])]

        const typed = withTypedAnswer(original, 'Hello')

        expect(typed.slice(0, 1)).toEqual(original)
        expect(typed[1]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'Hello' }] })
    })
})
