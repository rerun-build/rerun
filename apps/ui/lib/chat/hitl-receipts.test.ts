import { describe, expect, it } from 'vitest'

import { billedMicrosOf, readSpendQuote } from '@rerun/contracts'

import { hitlCallBefore, hitlCallKind, isLatestUserMessage, spentAfter } from './hitl-receipts'

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

})

const spendCall = { type: 'tool-request_spend', toolCallId: 's1', input: { purpose: 'Find 40 emails' }, output: { quote: { totalMicros: 1_800_000, lines: [] } } }
const paid = (billedMicros: number) => ({ type: 'tool-paid_data', output: { status: 'found', billedMicros, message: 'Found.' } })

const thread = [
    { role: 'assistant', parts: [{ type: 'text' }, spendCall] },
    { role: 'user', parts: [{ type: 'text' }] },
    { role: 'assistant', parts: [paid(45_000), { type: 'tool-web_search', output: { billedMicros: 99 } }, paid(0)] },
    { role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'mcp__rerun__paid_data', output: { billedMicros: 7_500 } }] },
    { role: 'user', parts: [{ type: 'text' }] },
    { role: 'assistant', parts: [paid(30_000)] },
]

describe('spend receipts', () => {
    it('knows the reply answers a spend request', () => {
        expect(hitlCallKind(hitlCallBefore(thread, 1))).toBe('spend')
        expect(hitlCallKind(undefined)).toBeNull()
    })

    it('adds up what the paid calls billed until the user writes again, bridged calls included', () => {
        expect(spentAfter(thread, 1)).toBe(52_500)
    })

    it('never counts a catalog read', () => {
        const read = [{ role: 'assistant', parts: [{ type: 'tool-paid_data_catalog', input: { group: 'tiktok' }, output: { billedMicros: 1_000 } }] }]
        expect(spentAfter(read, -1)).toBe(0)
    })

    it('tells the latest reply from an older one', () => {
        expect(isLatestUserMessage(thread, 1)).toBe(false)
        expect(isLatestUserMessage(thread, 4)).toBe(true)
        expect(isLatestUserMessage(thread, 5)).toBe(false)
    })
})

// Reloaded from the engine, a tool output sits behind the AI SDK `{ type: 'json', value }` envelope
// the live stream never has. The spend card, its guard and its receipt read the same figures either way.
describe('paid call figures reloaded from history', () => {
    const quote = { totalMicros: 90_000, lines: [{ capability: 'tiktok.user.profile', count: 5, units: 5, micros: 90_000 }], creditLeftMicros: 24_790_000 }

    it('reads a spend quote live and under the envelope alike', () => {
        expect(readSpendQuote({ status: 'delivered', quote })).toEqual(quote)
        expect(readSpendQuote({ type: 'json', value: { status: 'delivered', quote } })).toEqual(quote)
    })

    it('has no quote when the hub could not price the request', () => {
        expect(readSpendQuote({ type: 'text', value: 'Could not price this.' })).toBeNull()
        expect(readSpendQuote(undefined)).toBeNull()
    })

    it('reads what a paid call billed under the envelope', () => {
        expect(billedMicrosOf({ type: 'json', value: { status: 'found', billedMicros: 4_500 } })).toBe(4_500)
        expect(billedMicrosOf({ type: 'json', value: { status: 'miss' } })).toBe(0)
    })
})
