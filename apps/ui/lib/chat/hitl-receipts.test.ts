import { describe, expect, it } from 'vitest'

import { billedMicrosOf } from '@rerun/contracts'

import { hitlCallBefore } from './hitl-receipts'

const approvalCall = { type: 'tool-request_approval', toolCallId: 'a1', input: { approvals: [{ action: 'Send the email' }] } }

describe('hitlCallBefore', () => {
    it('finds the card a user reply answers, bridged or not', () => {
        const messages = [
            { role: 'assistant', parts: [{ type: 'text' }, approvalCall] },
            { role: 'user', parts: [{ type: 'text' }] },
        ]
        expect(hitlCallBefore(messages, 1)).toBe(approvalCall)
        const bridged = { type: 'dynamic-tool', toolName: 'mcp__rerun__ask_user', input: { question: 'Which domain?' } }
        expect(hitlCallBefore([{ role: 'assistant', parts: [bridged] }, { role: 'user', parts: [{ type: 'text' }] }], 1)).toBe(bridged)
    })

    it('finds nothing after an old spend request, which is no longer a card', () => {
        const spendCall = { type: 'tool-request_spend', toolCallId: 's1', input: { purpose: 'Find 40 emails' } }
        expect(hitlCallBefore([{ role: 'assistant', parts: [spendCall] }, { role: 'user', parts: [{ type: 'text' }] }], 1)).toBeUndefined()
    })
})

describe('paid call figures reloaded from history', () => {
    it('reads what a paid call billed under the envelope', () => {
        expect(billedMicrosOf({ type: 'json', value: { status: 'found', billedMicros: 4_500 } })).toBe(4_500)
        expect(billedMicrosOf({ type: 'json', value: { status: 'miss' } })).toBe(0)
    })
})
