import { describe, expect, it } from 'vitest'

import { replyTextOf } from './reply-text'

describe('replyTextOf', () => {
    it('approves or declines every action of the card, the way the card would', () => {
        const pending = { kind: 'approval' as const, input: { approvals: [{ action: 'Send 12 emails' }, { action: 'Post on LinkedIn' }] } }
        expect(replyTextOf({ action: 'approve', toolCallId: 'call-1' }, pending)).toContain('1. **APPROVED** — Send 12 emails\n\n2. **APPROVED** — Post on LinkedIn')
        expect(replyTextOf({ action: 'deny', toolCallId: 'call-1' }, pending)).toContain('1. **DECLINED** — Send 12 emails')
    })

    it('decides a spend', () => {
        expect(replyTextOf({ action: 'approve', toolCallId: 'call-1' }, { kind: 'spend', input: { purpose: 'Enrich 40 leads' } })).toMatch(/^Spend decision: \*\*APPROVED\*\* — Enrich 40 leads/)
    })

    it('answers a single question as its answer, and anything else as a message', () => {
        expect(replyTextOf({ action: 'reply', toolCallId: 'call-1', text: 'The French one' }, { kind: 'question', input: { questions: [{ question: 'Which list first?' }] } })).toBe('Here are my answers:\n\n**Which list first?**\nThe French one')
        expect(replyTextOf({ action: 'reply', toolCallId: 'call-1', text: 'Both' }, { kind: 'question', input: { questions: [{ question: 'A?' }, { question: 'B?' }] } })).toBe('Both')
        expect(replyTextOf({ action: 'reply', text: 'Thanks, now the Spanish one' }, null)).toBe('Thanks, now the Spanish one')
    })

    it('has nothing to approve on a question, nor without a card', () => {
        expect(replyTextOf({ action: 'approve', toolCallId: 'call-1' }, { kind: 'question', input: { question: 'Which?' } })).toBeNull()
        expect(replyTextOf({ action: 'deny', toolCallId: 'call-1' }, null)).toBeNull()
    })
})
