import { describe, expect, it } from 'vitest'

import { pendingRequestPeek } from '@/lib/chat/pending-request-peek'

const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
const assistant = (...parts: unknown[]) => ({ role: 'assistant', parts })
const text = (value: string) => ({ type: 'text', text: value })
const call = (name: string, input: Record<string, unknown>, id = `${name}-1`) => ({ type: `tool-${name}`, toolCallId: id, state: 'output-available', input, output: { status: 'delivered' } })

const ASK = call('ask_user', { questions: [{ question: 'How should the follow-ups sound?', options: ['Friendly', 'Formal'] }] })

describe('pendingRequestPeek', () => {
    it('reads the question the conversation stopped on, with the turn that asks it', () => {
        const peek = pendingRequestPeek([user('Follow up on my deals'), assistant(text('One thing about your tone first.'), ASK)])
        expect(peek.pending).toEqual({ kind: 'question', toolCallId: 'ask_user-1', input: ASK.input })
        expect(peek.ask).toBe('One thing about your tone first.')
        expect(peek.before).toBeNull()
    })

    it('keeps the agent turn right before the ask as context', () => {
        const peek = pendingRequestPeek([user('Go'), assistant(text('I drafted 23 follow-ups.')), assistant(text('Before anything leaves:'), call('request_approval', { approvals: [{ action: 'Send to lena@northwind.io' }] }))])
        expect(peek.pending?.kind).toBe('approval')
        expect(peek.before).toBe('I drafted 23 follow-ups.')
    })

    it('reads a credential request', () => {
        const peek = pendingRequestPeek([assistant(text('I need a key.'), call('request_secret', { reason: 'To read your deals', secrets: [{ key: 'CRM_TOKEN', label: 'API token' }] }))])
        expect(peek.pending?.kind).toBe('secret')
    })

    it('keeps the work of the turn apart from the paragraph that asks', () => {
        const peek = pendingRequestPeek([user('Go'), assistant(text('I went through your pipeline.'), call('db_query', { sql: 'select 1' }), text('I drafted 23 follow-ups.'), call('fs_write', { path: 'a.md' }), text(' One thing about your tone first. '), ASK)])
        expect(peek.ask).toBe('One thing about your tone first.')
        expect(peek.before).toBe('I went through your pipeline.\n\nI drafted 23 follow-ups.')
    })

    it('adds what the agent wrote after its request, as the chat shows it', () => {
        const peek = pendingRequestPeek([assistant(text('Before I send anything:'), ASK, text('I ask because the drafts go out today.'))])
        expect(peek.ask).toBe('Before I send anything:\n\nI ask because the drafts go out today.')
        expect(peek.before).toBeNull()
    })

    it('finds nothing pending once the user has answered', () => {
        const peek = pendingRequestPeek([assistant(text('One thing first.'), ASK), user('Friendly')])
        expect(peek).toEqual({ pending: null, ask: '', before: null })
    })

    it('finds nothing pending in a turn that only talks', () => {
        expect(pendingRequestPeek([user('Hi'), assistant(text('Hello!'))]).pending).toBeNull()
        expect(pendingRequestPeek([]).pending).toBeNull()
    })
})
