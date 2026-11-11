import type { UserIdentity } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { ownsEmail } from './account-emails'

const identity = (email: string, emailVerified: boolean) => ({ provider: 'google', identity_data: { email, email_verified: emailVerified } }) as unknown as UserIdentity

describe('ownsEmail', () => {
    it('answers to the primary address whatever its case', () => {
        expect(ownsEmail({ email: 'me@acme.test', identities: [] }, 'ME@acme.test')).toBe(true)
    })

    it('answers to the verified address of a linked identity', () => {
        expect(ownsEmail({ email: 'me@acme.test', identities: [identity('Linked@other.test', true)] }, 'linked@other.test')).toBe(true)
    })

    it('ignores a linked address nobody verified', () => {
        expect(ownsEmail({ email: 'me@acme.test', identities: [identity('linked@other.test', false)] }, 'linked@other.test')).toBe(false)
    })

    it('refuses an address the account does not hold, identities missing', () => {
        expect(ownsEmail({ email: 'me@acme.test' }, 'someone@else.test')).toBe(false)
    })
})
