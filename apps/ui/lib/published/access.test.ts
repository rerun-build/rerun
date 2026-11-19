import { describe, expect, it } from 'vitest'
import { coworkerAccessMessage, effectivePolicy, humanMayGrant, inviteAllows, resolveCoworkerAccess } from './access'

describe('effectivePolicy', () => {
    it('gives the default policy to a workspace that picked none', () => {
        expect(effectivePolicy(null)).toBe('people')
        expect(effectivePolicy('never')).toBe('never')
        expect(effectivePolicy('bogus')).toBe('people')
    })
})

describe('resolveCoworkerAccess', () => {
    it('starts a new link for the members', () => {
        expect(resolveCoworkerAccess({ policy: 'people' })).toEqual({ access: 'workspace', requestedAccess: null })
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

    it('points the coworker at the button of the card rather than a reply or an admin', () => {
        const message = coworkerAccessMessage('public', resolveCoworkerAccess({ policy: 'people', requested: 'public' }), [])
        expect(message).toContain('button that makes it public')
        expect(message).toContain('no admin needed')
        expect(message).toContain('offer no quick reply')
    })
})
