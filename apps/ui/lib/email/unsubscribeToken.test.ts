import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildUnsubscribeUrl, createUnsubscribeToken, listUnsubscribeHeaders, verifyUnsubscribeToken } from './unsubscribeToken'

const SECRET = 'test-unsubscribe-secret'
const USER_ID = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f'

function signed(rawPayload: string): string {
    const payload = Buffer.from(rawPayload, 'utf8').toString('base64url')
    return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`
}

beforeEach(() => vi.stubEnv('UNSUBSCRIBE_SECRET', SECRET))
afterEach(() => vi.unstubAllEnvs())

describe('verifyUnsubscribeToken', () => {
    it('reads back the user of an unscoped token', () => {
        expect(verifyUnsubscribeToken(createUnsubscribeToken(USER_ID))).toEqual({ userId: USER_ID, scope: null })
    })

    it('reads back the scope of a scoped token', () => {
        expect(verifyUnsubscribeToken(createUnsubscribeToken(USER_ID, 'runs'))).toEqual({ userId: USER_ID, scope: 'runs' })
    })

    it('still accepts a legacy token carrying the bare user id', () => {
        expect(verifyUnsubscribeToken(signed(USER_ID))).toEqual({ userId: USER_ID, scope: null })
    })

    it('reads an unknown scope as the account categories', () => {
        expect(verifyUnsubscribeToken(signed(`${USER_ID}\nbilling`))).toEqual({ userId: USER_ID, scope: null })
    })

    it('rejects a token whose signature was tampered with', () => {
        const [payload, signature] = createUnsubscribeToken(USER_ID).split('.')
        const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`

        expect(verifyUnsubscribeToken(`${payload}.${flipped}`)).toBeNull()
    })

    it('rejects a payload swapped for another user under the original signature', () => {
        const [, signature] = createUnsubscribeToken(USER_ID).split('.')
        const otherPayload = Buffer.from('someone-else', 'utf8').toString('base64url')

        expect(verifyUnsubscribeToken(`${otherPayload}.${signature}`)).toBeNull()
    })

    it('rejects a token signed with another secret', () => {
        const token = createUnsubscribeToken(USER_ID)
        vi.stubEnv('UNSUBSCRIBE_SECRET', 'rotated')

        expect(verifyUnsubscribeToken(token)).toBeNull()
    })

    it('rejects a token without exactly two parts', () => {
        const token = createUnsubscribeToken(USER_ID)

        expect(verifyUnsubscribeToken(token.split('.')[0])).toBeNull()
        expect(verifyUnsubscribeToken(`${token}.extra`)).toBeNull()
        expect(verifyUnsubscribeToken('')).toBeNull()
    })

    it('rejects a validly signed token with an empty user', () => {
        expect(verifyUnsubscribeToken(signed(''))).toBeNull()
        expect(verifyUnsubscribeToken(signed('\nruns'))).toBeNull()
    })

    it('throws rather than signing when no secret is configured', () => {
        vi.stubEnv('UNSUBSCRIBE_SECRET', '')

        expect(() => createUnsubscribeToken(USER_ID)).toThrow('UNSUBSCRIBE_SECRET is not set')
    })
})

describe('buildUnsubscribeUrl', () => {
    it('points at the unsubscribe page with a token that verifies', () => {
        const url = new URL(buildUnsubscribeUrl(USER_ID, 'https://moldwright.robagentic.tech', 'runs'))

        expect(url.pathname).toBe('/unsubscribe')
        expect(verifyUnsubscribeToken(url.searchParams.get('token')!)).toEqual({ userId: USER_ID, scope: 'runs' })
    })
})

describe('listUnsubscribeHeaders', () => {
    it('derives the one-click endpoint from the page URL', () => {
        expect(listUnsubscribeHeaders('https://moldwright.robagentic.tech/unsubscribe?token=abc')).toEqual({
            'List-Unsubscribe': '<https://moldwright.robagentic.tech/api/unsubscribe?token=abc>',
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        })
    })

    it('adds nothing without an unsubscribe page URL', () => {
        expect(listUnsubscribeHeaders()).toEqual({})
        expect(listUnsubscribeHeaders('https://moldwright.robagentic.tech/settings')).toEqual({})
    })
})
