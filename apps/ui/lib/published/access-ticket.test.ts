import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintAccessCookie, mintAccessTicket, openAccessCookie, openAccessTicket } from './access-ticket'

const CLAIMS = { slug: 'q3-proposal-k3m9xqw7pt', v: 2, grant: 'member' as const, sub: 'user-1' }

describe('access tickets and cookies', () => {
    beforeEach(() => vi.stubEnv('PUBLISHED_ACCESS_SECRET', 'test-secret'))
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.useRealTimers()
    })

    it('opens a ticket for the slug it was minted for', () => {
        expect(openAccessTicket(mintAccessTicket(CLAIMS), CLAIMS.slug)).toMatchObject(CLAIMS)
    })

    it('refuses a ticket for another slug, or tampered with', () => {
        const ticket = mintAccessTicket(CLAIMS)
        expect(openAccessTicket(ticket, 'other-slug')).toBeNull()
        const [payload] = ticket.split('.')
        expect(openAccessTicket(`${payload}.forged`, CLAIMS.slug)).toBeNull()
    })

    it('never opens a ticket as a cookie, nor the other way round', () => {
        expect(openAccessCookie(mintAccessTicket(CLAIMS), CLAIMS.slug)).toBeNull()
        expect(openAccessTicket(mintAccessCookie(CLAIMS), CLAIMS.slug)).toBeNull()
    })

    it('lets a ticket expire after a minute', () => {
        vi.useFakeTimers()
        const ticket = mintAccessTicket(CLAIMS)
        vi.advanceTimersByTime(61_000)
        expect(openAccessTicket(ticket, CLAIMS.slug)).toBeNull()
    })

    it('refuses everything signed with another secret', () => {
        const ticket = mintAccessTicket(CLAIMS)
        vi.stubEnv('PUBLISHED_ACCESS_SECRET', 'rotated')
        expect(openAccessTicket(ticket, CLAIMS.slug)).toBeNull()
    })
})
