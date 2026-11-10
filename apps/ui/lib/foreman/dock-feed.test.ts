import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'
import { foremanDockFeed, foremanNudge, IDLE_DOCK_FEED } from './dock-feed'
import type { PendingWidget } from './pending-widget'

const copy = { t: englishTranslator('chat.activity'), subRuns: englishTranslator('subRuns'), toolLabel: (toolName: string) => `<${toolName}>` }
const assistant = (parts: { type: string; [key: string]: unknown }[]) => ({ id: 'a1', role: 'assistant', parts })
const user = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Pause Shop Radar' }] }

const question: PendingWidget = { toolName: 'ask_user', toolCallId: 'c1', input: { questions: [{ question: 'Which shop?', options: ['A', 'B'] }, { question: 'Until when?' }] } }
const approval: PendingWidget = { toolName: 'request_approval', toolCallId: 'c2', input: { approvals: [{ action: 'Pause Shop Radar', detail: 'Until the token is renewed' }] } }

describe('foremanDockFeed', () => {
    it('says what a running tool is doing', () => {
        const running = assistant([{ type: 'tool-web_search', toolCallId: 't1', state: 'input-available' }])
        expect(foremanDockFeed({ messages: [user, running], busy: true, pending: null, failed: false, copy })).toEqual({ ...IDLE_DOCK_FEED, busy: true, label: 'Running <web_search>' })
    })

    it('leaves the label empty while the turn has said nothing yet', () => {
        expect(foremanDockFeed({ messages: [user], busy: true, pending: null, failed: false, copy }).label).toBeNull()
    })

    it('holds no reply back while the turn is still running', () => {
        const writing = assistant([{ type: 'text', text: 'Done', state: 'streaming' }])
        expect(foremanDockFeed({ messages: [user, writing], busy: true, pending: null, failed: false, copy }).reply).toBeNull()
    })

    it('hands over the last words of a finished turn', () => {
        const done = assistant([{ type: 'text', text: 'Looking.' }, { type: 'tool-web_search', toolCallId: 't1', state: 'output-available' }, { type: 'text', text: ' Shop Radar is paused. ' }])
        expect(foremanDockFeed({ messages: [user, done], busy: false, pending: null, failed: false, copy }).reply).toEqual({ id: 'a1', text: 'Shop Radar is paused.' })
    })

    it('drops the markdown the bubble does not render', () => {
        const done = assistant([{ type: 'text', text: '## Done\n**Shop Radar** is `paused`.' }])
        expect(foremanDockFeed({ messages: [user, done], busy: false, pending: null, failed: false, copy }).reply?.text).toBe('Done\nShop Radar is paused.')
    })

    it('has no reply when the user spoke last', () => {
        expect(foremanDockFeed({ messages: [user], busy: false, pending: null, failed: false, copy }).reply).toBeNull()
    })

    it('puts the question before the reply', () => {
        const asked = assistant([{ type: 'text', text: 'One thing first.' }])
        const feed = foremanDockFeed({ messages: [user, asked], busy: false, pending: question, failed: false, copy })
        expect(feed.pending).toBe(question)
        expect(feed.reply).toBeNull()
    })

    it('ignores a widget of the onboarding', () => {
        const widget = { toolName: 'ask_choice', toolCallId: 'c3', input: {} } as PendingWidget
        expect(foremanDockFeed({ messages: [user], busy: false, pending: widget, failed: false, copy }).pending).toBeNull()
    })

    it('reports a failed turn instead of the words before it', () => {
        const partial = assistant([{ type: 'text', text: 'Let me check' }])
        expect(foremanDockFeed({ messages: [user, partial], busy: false, pending: null, failed: true, copy })).toEqual({ ...IDLE_DOCK_FEED, failed: true })
    })
})

describe('foremanNudge', () => {
    it('holds up the first question and counts the others', () => {
        expect(foremanNudge(question)).toEqual({ id: 'c1', kind: 'question', title: 'Which shop?', detail: null, more: 1 })
    })

    it('holds up the action waiting for approval', () => {
        expect(foremanNudge(approval)).toEqual({ id: 'c2', kind: 'approval', title: 'Pause Shop Radar', detail: 'Until the token is renewed', more: 0 })
    })
})
