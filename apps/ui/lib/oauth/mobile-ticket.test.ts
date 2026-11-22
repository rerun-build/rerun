import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callbackGrant, mintCallbackGrant, mintConnectTicket, verifyConnectTicket } from './mobile-ticket'

const TICKET = { agentId: 'agent-1', key: 'notion@k3x9ab', workspaceId: 42, userId: 'user-1' }

function tamper(sealed: string): string {
    const [payload, signature] = sealed.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')), workspaceId: 7 })).toString('base64url')
    return `${forged}.${signature}`
}

beforeEach(() => {
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

describe('connect ticket', () => {
    it('round-trips its claims, with a name of its own for the row it opens', () => {
        const ticket = verifyConnectTicket(mintConnectTicket(TICKET))
        expect(ticket).toMatchObject({ ...TICKET, kind: 'ticket' })
        expect(ticket.jti).toMatch(/^[\w-]{22}$/)
        expect(verifyConnectTicket(mintConnectTicket(TICKET)).jti).not.toBe(ticket.jti)
    })

    it('refuses a grant presented as a ticket', () => {
        expect(() => verifyConnectTicket(GRANT())).toThrow('Invalid sign-in ticket')
    })

    it('carries a server registered outside the catalog in place of an app', () => {
        const ticket = { agentId: 'agent-1', server: 'linear', workspaceId: 42, userId: 'user-1' }
        expect(verifyConnectTicket(mintConnectTicket(ticket))).toMatchObject({ server: 'linear' })
    })

    it('refuses a missing or rewritten ticket', () => {
        expect(() => verifyConnectTicket(null)).toThrow('Missing sign-in ticket')
        expect(() => verifyConnectTicket(tamper(mintConnectTicket(TICKET)))).toThrow('Invalid sign-in ticket')
    })

    it('expires after two minutes', () => {
        const ticket = mintConnectTicket(TICKET)
        vi.advanceTimersByTime(121_000)
        expect(() => verifyConnectTicket(ticket)).toThrow('expired')
    })
})

const GRANT = () => mintCallbackGrant({ agentId: 'agent-1', workspaceId: 42, userId: 'user-1', jti: 'row-1' })

describe('callback grant', () => {
    it('leaves the web flow on its browser session', () => {
        expect(callbackGrant({ agentId: 'agent-1' })).toBeUndefined()
    })

    it('hands back the workspace, the person and the row it was minted for', () => {
        expect(callbackGrant({ agentId: 'agent-1', mobileGrant: GRANT() })).toMatchObject({ kind: 'grant', workspaceId: 42, userId: 'user-1', jti: 'row-1' })
    })

    it('outlives the ticket, for as long as the context cookie', () => {
        const mobileGrant = GRANT()
        vi.advanceTimersByTime(599_000)
        expect(callbackGrant({ agentId: 'agent-1', mobileGrant })?.workspaceId).toBe(42)
        vi.advanceTimersByTime(2_000)
        expect(() => callbackGrant({ agentId: 'agent-1', mobileGrant })).toThrow('expired')
    })

    it('refuses a rewritten grant, an empty one, one minted for another agent, and a ticket in its place', () => {
        const mobileGrant = GRANT()
        expect(() => callbackGrant({ agentId: 'agent-1', mobileGrant: tamper(mobileGrant) })).toThrow('Invalid sign-in grant')
        expect(() => callbackGrant({ agentId: 'agent-1', mobileGrant: '' })).toThrow('Missing sign-in grant')
        expect(() => callbackGrant({ agentId: 'agent-2', mobileGrant })).toThrow('Invalid sign-in grant')
        expect(() => callbackGrant({ agentId: 'agent-1', mobileGrant: mintConnectTicket(TICKET) })).toThrow('Invalid sign-in grant')
    })

    it('binds a grant of the Vault to its entry, and keeps it apart from the grants of coworkers', () => {
        const vaultGrant = mintCallbackGrant({ agentId: '', vaultItem: 'item-1', workspaceId: 42, userId: 'user-1', jti: 'row-1' })
        expect(callbackGrant({ agentId: '', vault: { itemId: 'item-1' }, mobileGrant: vaultGrant })).toMatchObject({ vaultItem: 'item-1', jti: 'row-1' })
        expect(() => callbackGrant({ agentId: '', vault: { itemId: 'item-2' }, mobileGrant: vaultGrant })).toThrow('Invalid sign-in grant')
        expect(() => callbackGrant({ agentId: '', mobileGrant: vaultGrant })).toThrow('Invalid sign-in grant')
        expect(() => callbackGrant({ agentId: '', vault: { itemId: 'item-1' }, mobileGrant: mintCallbackGrant({ agentId: '', workspaceId: 42, userId: 'user-1', jti: 'row-1' }) })).toThrow('Invalid sign-in grant')
    })
})
