import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConnectedAccount, grantedNothingButSignIn } from './client'

const SIGN_IN = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/contacts.other.readonly']

describe('getConnectedAccount', () => {
    beforeEach(() => vi.stubEnv('COMPOSIO_API_KEY', 'test-key'))
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    function answer(body: unknown) {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    }

    it('reads the scopes Google granted from the account state', async () => {
        answer({ id: 'ca_1', user_id: 'u', status: 'ACTIVE', auth_config: { id: 'ac_1' }, toolkit: { slug: 'gmail' }, state: { val: { scope: 'openid https://mail.google.com/' } } })

        const account = await getConnectedAccount('ca_1')

        expect(account.grantedScopes).toEqual(['openid', 'https://mail.google.com/'])
    })

    it('leaves the scopes unknown when Composio reports none', async () => {
        answer({ id: 'ca_1', user_id: 'u', status: 'INITIATED', auth_config: { id: 'ac_1' }, toolkit: { slug: 'gmail' }, state: { val: { status: 'INITIATED' } } })

        expect((await getConnectedAccount('ca_1')).grantedScopes).toBeUndefined()
    })
})

describe('grantedNothingButSignIn', () => {
    it('spots a Google sign-in that granted identity scopes only', () => {
        expect(grantedNothingButSignIn(SIGN_IN)).toBe(true)
        expect(grantedNothingButSignIn(['openid', 'https://www.googleapis.com/auth/userinfo.email'])).toBe(true)
    })

    it('accepts a sign-in that granted a scope of the app', () => {
        expect(grantedNothingButSignIn([...SIGN_IN, 'https://mail.google.com/'])).toBe(false)
        expect(grantedNothingButSignIn(['openid', 'https://www.googleapis.com/auth/webmasters.readonly'])).toBe(false)
    })

    it('never judges scopes it cannot read or that are not Google URLs', () => {
        expect(grantedNothingButSignIn(undefined)).toBe(false)
        expect(grantedNothingButSignIn([])).toBe(false)
        expect(grantedNothingButSignIn(['openid', 'profile', 'email'])).toBe(false)
    })
})
