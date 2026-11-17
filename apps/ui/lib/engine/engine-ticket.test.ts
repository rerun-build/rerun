import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'

import { mintDesktopTicket, mintRemoteTicket } from './engine-ticket'

describe('mintDesktopTicket', () => {
    it('signs a one-minute expiry and the agent with the Box key, in the shape the engine verifies', () => {
        const ticket = mintDesktopTicket('box-key', 'researcher', 'watch', 1_000)
        const [payload, signature] = ticket.split('.')
        expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({ exp: 61_000, agent: 'researcher', mode: 'watch' })
        expect(signature).toBe(createHmac('sha256', 'box-key').update(payload).digest('base64url'))
    })

    it('never carries the key', () => {
        expect(mintDesktopTicket('box-key', 'researcher', 'drive')).not.toContain('box-key')
    })
})

describe('mintRemoteTicket', () => {
    const computer = { id: 'c1', handle: 'studio-pc', name: 'Studio PC' }
    const claimsOf = (ticket: string) => JSON.parse(Buffer.from(ticket.split('.')[0], 'base64url').toString('utf8'))

    it('signs the computer the hub vouches for, for this socket and one minute', () => {
        const ticket = mintRemoteTicket('box-key', computer, 1_000)
        const [payload, signature] = ticket.split('.')
        expect(claimsOf(ticket)).toEqual({ aud: 'remote', exp: 61_000, jti: expect.any(String), computer })
        expect(signature).toBe(createHmac('sha256', 'box-key').update(payload).digest('base64url'))
        expect(ticket).not.toContain('box-key')
    })

    it('mints a new single-use id each time', () => {
        expect(claimsOf(mintRemoteTicket('k', computer)).jti).not.toBe(claimsOf(mintRemoteTicket('k', computer)).jti)
    })
})
