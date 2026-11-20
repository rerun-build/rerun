import { describe, expect, it } from 'vitest'
import { buildInstallMessage } from '@/lib/chat/install-marker'
import { authorIdOf, authorTurnsOf } from '@/lib/chat/message-author'

const user = (id: string, authorId?: string, text = 'hello') => ({ id, role: 'user', parts: [{ type: 'text', text }], ...(authorId && { metadata: { authorId } }) })
const agent = (id: string) => ({ id, role: 'assistant', parts: [{ type: 'text', text: 'done' }], metadata: { model: 'sonnet' } })

describe('authorIdOf', () => {
    it('reads who typed a user message', () => {
        expect(authorIdOf(user('m1', 'u1'))).toBe('u1')
    })

    it('leaves unsigned what nobody typed', () => {
        expect(authorIdOf(user('m1'))).toBeUndefined()
        expect(authorIdOf(agent('m2'))).toBeUndefined()
        expect(authorIdOf({ ...agent('m3'), metadata: { authorId: 'u1' } })).toBeUndefined()
    })
})

describe('authorTurnsOf', () => {
    it('groups what one person sent in a row and keeps each message at its index', () => {
        const turns = authorTurnsOf([user('m1', 'u1'), user('m2', 'u1'), user('m3', 'u2'), agent('m4'), user('m5', 'u2')])
        expect(turns.map(turn => [turn.key, turn.authorId, turn.items.map(item => item.index)])).toEqual([
            ['m1', 'u1', [0, 1]],
            ['m3', 'u2', [2]],
            ['m4', undefined, [3]],
            ['m5', 'u2', [4]],
        ])
    })

    it('never groups unsigned messages together', () => {
        expect(authorTurnsOf([user('m1'), user('m2')])).toHaveLength(2)
    })

    it('keeps what the Chief of Staff sent for someone apart from what they typed', () => {
        const relayed = { ...user('m2'), metadata: { authorId: 'u1', relayedBy: 'foreman' } }
        const turns = authorTurnsOf([user('m1', 'u1'), relayed, user('m3', 'u1')])
        expect(turns.map(turn => [turn.key, turn.authorId, turn.relayed])).toEqual([
            ['m1', 'u1', false],
            ['m2', 'u1', true],
            ['m3', 'u1', false],
        ])
    })
})

describe('install guide', () => {
    it('stays unsigned even though a person clicked it off', () => {
        const install = buildInstallMessage('Connect your CRM.', 'Closer')
        expect(authorIdOf(user('m1', 'u1', install))).toBeUndefined()
    })
})
