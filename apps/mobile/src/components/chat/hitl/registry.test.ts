import type { PendingHitl } from '@rerun/contracts'

import { replacesComposer, widgetFor, type HitlWidgets } from './registry'
import { askOf, firstAsk } from './summary'

const question = (input: Record<string, unknown>): PendingHitl => ({ kind: 'question', toolCallId: 'call-1', input, output: undefined })
const widgets: HitlWidgets = { question: { maxVersion: 1, render: () => null } }

describe('widgetFor', () => {
    it('draws a kind the app has a widget for, up to the version it was written for', () => {
        expect(widgetFor(question({ questions: [] }), widgets)).toBe(widgets.question)
        expect(widgetFor(question({ questions: [], v: 1 }), widgets)).toBe(widgets.question)
        expect(widgetFor(question({ questions: [], v: 2 }), widgets)).toBeNull()
    })

    it('leaves a kind without a widget to the fallback', () => {
        expect(widgetFor({ kind: 'approval', toolCallId: 'call-2', input: { approvals: [] }, output: undefined }, widgets)).toBeNull()
    })
})

describe('replacesComposer', () => {
    const secret = (input: Record<string, unknown>): PendingHitl => ({ kind: 'secret', toolCallId: 'call-3', input, output: undefined })

    it('keeps the composer for a question the app cannot draw, and takes it away from one it draws', () => {
        expect(replacesComposer(null, widgets)).toBe(false)
        expect(replacesComposer(question({ questions: [], v: 2 }), widgets)).toBe(false)
        expect(replacesComposer(question({ questions: [] }), widgets)).toBe(true)
    })

    it('takes it away from any request for a key, drawn or not', () => {
        expect(replacesComposer(secret({ secrets: [], v: 2 }), { secret: { maxVersion: 1, render: () => null } })).toBe(true)
        expect(replacesComposer(secret({ secrets: [] }), {})).toBe(true)
    })
})

describe('what a fallback card reads out', () => {
    it('says what a known block asks', () => {
        expect(firstAsk('question', { questions: [{ question: 'Which list?', options: [] }] })).toBe('Which list?')
        expect(firstAsk('takeover', { url: 'https://x.com', reason: 'Solve the captcha' })).toBe('Solve the captcha')
        expect(firstAsk('mcp', { name: 'mobbin', reason: '  ' })).toBeNull()
    })

    it('finds the ask of a call it cannot name in the usual keys', () => {
        expect(askOf({ document: 'NDA', reason: 'Sign the NDA' })).toBe('Sign the NDA')
        expect(askOf({ count: 3 })).toBeNull()
    })
})
