import { describe, expect, it } from 'vitest'

import { buildAttachmentsRef, counterpartIn, editableTextOf, messageEditRefusalOf, messageLinkOf, replyBounds, userIndexBefore } from '@rerun/contracts'

import { actionForKey, isSelectableMessage } from './message-actions'
import { buildInstallMessage } from './install-marker'
import { appendVoiceMarker, buildVoiceMarker } from '@/lib/voice/marker'

const say = (id: string, role: 'user' | 'assistant', text: string) => ({ id, role, parts: text ? [{ type: 'text', text }] : [{ type: 'tool-search' }] })

describe('actionForKey', () => {
    it('reads the letters in either case and both delete keys', () => {
        expect(['e', 'R', 'c', 'L', 'Backspace', 'Delete', 'x'].map(actionForKey)).toEqual(['edit', 'regenerate', 'copy', 'link', 'delete', 'delete', null])
    })
})

describe('isSelectableMessage', () => {
    it('takes what the person wrote and what the coworker answered in words', () => {
        expect(isSelectableMessage(say('u', 'user', 'find agencies'))).toBe(true)
        expect(isSelectableMessage(say('a', 'assistant', 'found 20'))).toBe(true)
    })

    it('leaves out a turn of tool calls alone and the divider of an install', () => {
        expect(isSelectableMessage(say('a', 'assistant', ''))).toBe(false)
        expect(isSelectableMessage(say('u', 'user', buildInstallMessage('Set up the CRM', 'Léa')))).toBe(false)
    })
})

describe('editableTextOf', () => {
    it('edits the words and sends the files back with them', () => {
        const ref = buildAttachmentsRef(['uploads/leads.csv'])
        const editable = editableTextOf(say('u', 'user', `Clean this list\n\n${ref}`))
        expect(editable?.text).toBe('Clean this list')
        expect(editable?.rebuild('Clean and dedupe this list')).toBe(`Clean and dedupe this list\n\n${ref}`)
    })

    it('offers nothing to edit on a voice message or a reply', () => {
        expect(editableTextOf(say('u', 'user', appendVoiceMarker('hello', buildVoiceMarker({ src: 'voice/a.webm', durationMs: 1000, levels: [0.2, 0.5] }))))).toBeNull()
        expect(editableTextOf(say('a', 'assistant', 'hi'))).toBeNull()
    })
})

describe('the turn around a message', () => {
    const thread = [say('u1', 'user', 'find'), say('a1', 'assistant', ''), say('a2', 'assistant', 'found'), say('u2', 'user', 'send'), say('a3', 'assistant', 'sent')]

    it('finds the reply a message belongs to and the message of the user it answers', () => {
        expect(replyBounds(thread, 2)).toEqual({ start: 1, end: 3 })
        expect(replyBounds(thread, 4)).toEqual({ start: 4, end: 5 })
        expect(userIndexBefore(thread, 2)).toBe(0)
        expect(userIndexBefore(thread, 0)).toBe(-1)
    })
})

describe('counterpartIn', () => {
    const live = [say('engine-u1', 'user', 'find'), say('engine-a1', 'assistant', 'found'), say('local-u2', 'user', 'send'), say('local-a2', 'assistant', 'sent')]
    const history = [say('engine-u1', 'user', 'find'), say('engine-a1', 'assistant', 'found'), say('engine-u2', 'user', 'send'), say('engine-t2', 'assistant', ''), say('engine-a2', 'assistant', 'sent')]

    it('maps a message the chat streamed to the row the history gives it', () => {
        expect(counterpartIn(live, 2, history)).toBe('engine-u2')
        expect(counterpartIn(live, 3, history)).toBe('engine-a2')
    })

    it('finds nothing for a turn the history does not hold yet', () => {
        expect(counterpartIn(live, 3, history.slice(0, 2))).toBeNull()
    })

    it('skips the second row a Retry wrote for a message the chat shows once', () => {
        const retried = [say('local-u1', 'user', 'find'), say('local-a1', 'assistant', 'found'), say('local-u2', 'user', 'send'), say('local-a2', 'assistant', 'sent')]
        const stored = [say('engine-u1a', 'user', 'find'), say('engine-u1b', 'user', 'find'), say('engine-a1', 'assistant', 'found'), say('engine-u2', 'user', 'send'), say('engine-a2', 'assistant', 'sent')]
        expect(counterpartIn(retried, 2, stored)).toBe('engine-u2')
        expect(counterpartIn(retried, 3, stored)).toBe('engine-a2')
        expect(counterpartIn(retried, 0, stored)).toBe('engine-u1b')
        expect(counterpartIn(retried, 1, stored)).toBe('engine-a1')
    })

    it('ignores a message written after the ones on screen', () => {
        const later = [...history, say('engine-u3', 'user', 'and call them'), say('engine-a3', 'assistant', 'calling')]
        expect(counterpartIn(live, 2, later)).toBe('engine-u2')
        expect(counterpartIn(live, 3, later)).toBe('engine-a2')
    })

    it('finds nothing when the row at that turn says something else', () => {
        const other = [say('engine-u1', 'user', 'find'), say('engine-a1', 'assistant', 'found'), say('engine-u2', 'user', 'something else'), say('engine-a2', 'assistant', 'sent')]
        expect(counterpartIn(live, 2, other)).toBeNull()
        expect(counterpartIn(live, 3, other)).toBeNull()
    })

    it('matches a message with files by its words', () => {
        const ref = buildAttachmentsRef(['uploads/leads.csv'])
        const streamed = [say('local-u1', 'user', 'Clean this list')]
        expect(counterpartIn(streamed, 0, [say('engine-u1', 'user', `Clean this list\n\n${ref}`)])).toBe('engine-u1')
    })
})

describe('messageEditRefusalOf', () => {
    it('reads the refusals of the hub out of the error the chat holds', () => {
        expect(messageEditRefusalOf('{"error":"engine_outdated"}')).toBe('engineOutdated')
        expect(messageEditRefusalOf('{"error":"message_not_found"}')).toBe('notFound')
        expect(messageEditRefusalOf('Engine error: 500')).toBeNull()
    })
})

describe('messageLinkOf', () => {
    it('names the coworker, the conversation and the message', () => {
        expect(messageLinkOf('https://app.rerun.build', { agentId: 'a1', sessionId: 's1', messageId: 'engine-m1' })).toBe('https://app.rerun.build/?agent=a1&session=s1&message=engine-m1')
    })
})
