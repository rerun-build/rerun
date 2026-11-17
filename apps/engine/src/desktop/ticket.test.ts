import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { setEnv } from '../config/env.js'
import { verifyDesktopTicket } from './ticket.js'

const KEY = 'box-key'

function ticket(claims: Record<string, unknown>, key = KEY): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

// One import for the whole file: the key is switched on the cached environment, not by reloading.
function verifierWith(key: string) {
    setEnv({ RERUN_API_KEY: key })
    return verifyDesktopTicket
}

describe('verifyDesktopTicket', () => {
    it('resolves a ticket signed with the box key that has not expired to the agent it names', async () => {
        const verify = await verifierWith(KEY)
        expect(verify(ticket({ exp: 2_000, agent: 'a1', mode: 'watch' }), 1_000)).toEqual({ agentId: 'a1', mode: 'watch' })
        expect(verify(ticket({ exp: 2_000, agent: 'a1', mode: 'drive' }), 1_000)).toEqual({ agentId: 'a1', mode: 'drive' })
    })

    it('reads a ticket that names no mode, or one it does not know, as one that drives', async () => {
        const verify = await verifierWith(KEY)
        expect(verify(ticket({ exp: 2_000, agent: 'a1' }), 1_000)).toEqual({ agentId: 'a1', mode: 'drive' })
        expect(verify(ticket({ exp: 2_000, agent: 'a1', mode: 'own' }), 1_000)).toEqual({ agentId: 'a1', mode: 'drive' })
    })

    it('refuses an expired ticket', async () => {
        const verify = await verifierWith(KEY)
        expect(verify(ticket({ exp: 999, agent: 'a1' }), 1_000)).toBeNull()
    })

    it('refuses a ticket that names no agent', async () => {
        const verify = await verifierWith(KEY)
        expect(verify(ticket({ exp: 2_000 }), 1_000)).toBeNull()
        expect(verify(ticket({ exp: 2_000, agent: '' }), 1_000)).toBeNull()
        expect(verify(ticket({ exp: 2_000, agent: 7 }), 1_000)).toBeNull()
    })

    it('refuses a ticket signed with another key, a payload moved to another agent, or no ticket at all', async () => {
        const verify = await verifierWith(KEY)
        expect(verify(ticket({ exp: 2_000, agent: 'a1' }, 'other-key'), 1_000)).toBeNull()
        const [, signature] = ticket({ exp: 2_000, agent: 'a1' }).split('.')
        expect(verify(`${Buffer.from(JSON.stringify({ exp: 2_000, agent: 'a2' })).toString('base64url')}.${signature}`, 1_000)).toBeNull()
        expect(verify(null, 1_000)).toBeNull()
        expect(verify('garbage', 1_000)).toBeNull()
        expect(verify(ticket({ agent: 'a1' }), 1_000)).toBeNull()
    })

    it('skips the signature on an engine that runs without a key, like the HTTP API skips the bearer', async () => {
        const verify = await verifierWith('')
        const unsigned = Buffer.from(JSON.stringify({ exp: 2_000, agent: 'a1' })).toString('base64url')
        expect(verify(unsigned, 1_000)).toEqual({ agentId: 'a1', mode: 'drive' })
        expect(verify(null, 1_000)).toBeNull()
    })
})
