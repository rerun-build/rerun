import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { dedupeMessagesById } from './dedupe-messages'

const user = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] })
const answer = (id: string, text: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }] })

describe('dedupeMessagesById', () => {
    it('keeps each answer once, with its furthest copy', () => {
        const messages = [user('u1', 'I am a video editor'), answer('a', 'Got'), answer('b', 'Got it'), answer('a', 'Got it, Ali.'), answer('b', 'Got it, Ali, you are'), user('u2', 'Next')]

        expect(dedupeMessagesById(messages)).toEqual([user('u1', 'I am a video editor'), answer('a', 'Got it, Ali.'), answer('b', 'Got it, Ali, you are'), user('u2', 'Next')])
    })

    it('keeps a resumed answer above the message that followed it', () => {
        const messages = [user('k', 'start'), answer('x', 'Hi'), user('u3', 'voice chat app'), answer('y', 'Which'), answer('x', 'Hi there'), answer('y', 'Which one?')]

        expect(dedupeMessagesById(messages)).toEqual([user('k', 'start'), answer('x', 'Hi there'), user('u3', 'voice chat app'), answer('y', 'Which one?')])
    })

    it('keeps messages that have no id to match on', () => {
        const messages = [user('', 'one'), answer('', 'two'), answer('', 'three')]

        expect(dedupeMessagesById(messages)).toBe(messages)
    })

    it('hands a clean transcript back untouched', () => {
        const messages = [user('u1', 'Hello'), answer('a', 'Hi')]

        expect(dedupeMessagesById(messages)).toBe(messages)
    })
})
