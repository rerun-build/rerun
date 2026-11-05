import { describe, expect, it } from 'vitest'
import { coworkerAccessMessage, effectivePolicy, humanMayGrant, inviteAllows, normalizeInvites, resolveCoworkerAccess, shownPolicy } from './access'

describe('effectivePolicy', () => {
    it('keeps every link public before the launch for a workspace that picked nothing', () => {
        expect(effectivePolicy(null, false)).toBe('legacy')
        expect(effectivePolicy(null, true)).toBe('people')
        expect(effectivePolicy('never', false)).toBe('never')
        expect(effectivePolicy('bogus', true)).toBe('people')
    })
})

describe('shownPolicy', () => {
    it('shows what a coworker does for a workspace that picked nothing', () => {
        expect(shownPolicy(null, false)).toBe('anyone')
        expect(shownPolicy(null, true)).toBe('people')
        expect(shownPolicy('people', false)).toBe('people')
        expect(shownPolicy('never', true)).toBe('never')
    })
})

describe('resolveCoworkerAccess', () => {
    it('starts a new link for the members, or public before the launch', () => {
        expect(resolveCoworkerAccess({ policy: 'people' })).toEqual({ access: 'workspace', requestedAccess: null })
        expect(resolveCoworkerAccess({ policy: 'legacy' })).toEqual({ access: 'public', requestedAccess: null })
    })

    it('keeps the current access on a republish that names none', () => {
        const current = { access: 'public' as const, requestedAccess: null }
        expect(resolveCoworkerAccess({ policy: 'people', current })).toEqual(current)
    })

    it('holds a public link for a person under the default policy', () => {
        expect(resolveCoworkerAccess({ policy: 'people', requested: 'public' })).toEqual({ access: 'workspace', requestedAccess: 'public' })
        expect(resolveCoworkerAccess({ policy: 'people', requested: 'public', current: { access: 'password', requestedAccess: null } })).toEqual({ access: 'password', requestedAccess: 'public' })
    })

    it('never takes back a link a person already made public', () => {
        expect(resolveCoworkerAccess({ policy: 'people', requested: 'public', current: { access: 'public', requestedAccess: null } })).toEqual({ access: 'public', requestedAccess: null })
    })

    it('lets the coworker go public when the workspace allows it', () => {
        expect(resolveCoworkerAccess({ policy: 'anyone', requested: 'public' })).toEqual({ access: 'public', requestedAccess: null })
    })

    it('keeps the link to the members without an ask when nothing goes public', () => {
        expect(resolveCoworkerAccess({ policy: 'never', requested: 'public' })).toEqual({ access: 'workspace', requestedAccess: null })
    })

    it('grants the narrower modes as asked', () => {
        expect(resolveCoworkerAccess({ policy: 'never', requested: 'invited' })).toEqual({ access: 'invited', requestedAccess: null })
        expect(resolveCoworkerAccess({ policy: 'people', requested: 'password', current: { access: 'workspace', requestedAccess: 'public' } })).toEqual({ access: 'password', requestedAccess: null })
    })
})

describe('humanMayGrant', () => {
    it('refuses public only when the workspace turned it off', () => {
        expect(humanMayGrant('people', 'public')).toBe(true)
        expect(humanMayGrant('never', 'public')).toBe(false)
        expect(humanMayGrant('never', 'invited')).toBe(true)
    })
})

describe('normalizeInvites', () => {
    it('lowercases, dedupes and reads a bare domain as one', () => {
        expect(normalizeInvites([' Marie@Northwind.com', 'marie@northwind.com', 'northwind.com', '@globex.io', ''])).toEqual(['marie@northwind.com', '@northwind.com', '@globex.io'])
    })

    it('refuses what is neither an email nor a domain', () => {
        expect(() => normalizeInvites(['marie'])).toThrow('Not an email or a domain: marie')
        expect(() => normalizeInvites(['@nodot'])).toThrow()
    })
})

describe('inviteAllows', () => {
    const invited = ['marie@northwind.com', '@globex.io']

    it('lets in an invited address or anyone at an invited domain', () => {
        expect(inviteAllows(invited, 'MARIE@northwind.com')).toBe(true)
        expect(inviteAllows(invited, 'tom@globex.io')).toBe(true)
    })

    it('keeps out the rest, a lookalike domain included', () => {
        expect(inviteAllows(invited, 'paul@northwind.com')).toBe(false)
        expect(inviteAllows(invited, 'tom@evilglobex.io')).toBe(false)
        expect(inviteAllows(invited, 'globex.io')).toBe(false)
    })
})

describe('coworkerAccessMessage', () => {
    it('tells the coworker a public link was refused by the policy', () => {
        const message = coworkerAccessMessage('public', resolveCoworkerAccess({ policy: 'never', requested: 'public' }), [])
        expect(message).toMatch(/^Public links are turned off for this workspace/)
        expect(message).toContain('Only the members of this workspace can open it')
    })

    it('says nothing of a refusal when the link went public or waits for a person', () => {
        expect(coworkerAccessMessage('public', resolveCoworkerAccess({ policy: 'anyone', requested: 'public' }), [])).toBe('Anyone with the link can open it.')
        expect(coworkerAccessMessage('public', resolveCoworkerAccess({ policy: 'people', requested: 'public' }), [])).toMatch(/^Live for the workspace members only/)
        expect(coworkerAccessMessage(undefined, resolveCoworkerAccess({ policy: 'never' }), [])).toBe('Only the members of this workspace can open it, once signed in.')
    })
})
