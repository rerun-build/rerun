import { createHmac } from 'node:crypto'

const KEY = 'box-key'
process.env.RERUN_API_KEY = KEY

const { describe, expect, it } = await import('vitest')
const { verifyRemoteTicket: verify } = await import('./ticket.js')

const computer = { id: 'c1', handle: 'studio-pc', name: 'Studio PC' }

function ticket(claims: Record<string, unknown>, key = KEY): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

// The spent tickets are remembered for the whole file: each test names its own.
describe('verifyRemoteTicket', () => {
    it('resolves a signed, unexpired ticket for this socket to the computer the hub named', () => {
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: 'a1', computer }), 1_000)).toEqual({ computer, jti: 'a1' })
    })

    it('opens one handshake only: the same ticket is refused the second time', () => {
        const raw = ticket({ aud: 'remote', exp: 2_000, jti: 'b1', computer })
        expect(verify(raw, 1_000)).not.toBeNull()
        expect(verify(raw, 1_500)).toBeNull()
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: 'b2', computer }), 1_500)).not.toBeNull()
    })

    it('forgets spent tickets once they expire, without letting an expired one in', () => {
        const raw = ticket({ aud: 'remote', exp: 2_000, jti: 'c1', computer })
        expect(verify(raw, 1_000)).not.toBeNull()
        expect(verify(raw, 3_000)).toBeNull()
    })

    it('refuses a screen ticket, a ticket for another audience, or one with no single-use id', () => {
        expect(verify(ticket({ exp: 2_000, agent: 'a1', mode: 'drive' }), 1_000)).toBeNull()
        expect(verify(ticket({ aud: 'desktop', exp: 2_000, jti: 'd1', computer }), 1_000)).toBeNull()
        expect(verify(ticket({ aud: 'remote', exp: 2_000, computer }), 1_000)).toBeNull()
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: '', computer }), 1_000)).toBeNull()
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: 'x'.repeat(65), computer }), 1_000)).toBeNull()
    })

    it('refuses a ticket whose computer is missing or malformed', () => {
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: 'e1' }), 1_000)).toBeNull()
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: 'e2', computer: { ...computer, handle: 'Studio PC' } }), 1_000)).toBeNull()
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: 'e3', computer: { ...computer, id: '' } }), 1_000)).toBeNull()
    })

    it('refuses a ticket signed with another key, expired, or not a ticket at all', () => {
        expect(verify(ticket({ aud: 'remote', exp: 2_000, jti: 'f1', computer }, 'other'), 1_000)).toBeNull()
        expect(verify(ticket({ aud: 'remote', exp: 999, jti: 'f2', computer }), 1_000)).toBeNull()
        expect(verify(null, 1_000)).toBeNull()
        expect(verify('garbage', 1_000)).toBeNull()
        expect(verify(`${Buffer.from('[1]').toString('base64url')}`, 1_000)).toBeNull()
    })
})
