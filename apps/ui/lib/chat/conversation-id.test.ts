import { describe, expect, it } from 'vitest'

import { isConversationId } from './conversation-id'

describe('isConversationId', () => {
    it('takes the UUID of a conversation row', () => {
        expect(isConversationId('4dfbb571-8f9a-4ff2-810c-11e414cb8569')).toBe(true)
        expect(isConversationId('4DFBB571-8F9A-4FF2-810C-11E414CB8569')).toBe(true)
    })

    it('refuses an engine session id and anything else', () => {
        expect(isConversationId('3ovpbq4znpvo17t1in2bs')).toBe(false)
        expect(isConversationId('')).toBe(false)
        expect(isConversationId('4dfbb571-8f9a-4ff2-810c-11e414cb8569x')).toBe(false)
    })
})
