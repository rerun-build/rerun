import { describe, expect, it } from 'vitest'

import { brandProblems, iconProblem, isHttpsUrl, readCredits, readHostname } from './input'
import type { BrandFields } from './types'

const FIELDS: BrandFields = { name: 'Nordlys', color: '#1668e3', supportEmail: 'help@nordlys.agency', docsUrl: 'https://help.nordlys.agency', termsUrl: '', privacyUrl: '' }

describe('readCredits', () => {
    it('reads whole credits through whatever separates the digits', () => {
        expect(readCredits('1,250')).toBe(1250)
        expect(readCredits('1 250')).toBe(1250)
        expect(readCredits('12 500')).toBe(12_500)
    })

    it('reads nothing as null and stops at nine digits', () => {
        expect(readCredits('')).toBeNull()
        expect(readCredits('abc')).toBeNull()
        expect(readCredits('-')).toBeNull()
        expect(readCredits('12345678901')).toBe(123_456_789)
    })
})

describe('readHostname', () => {
    it('reads a pasted address as its domain', () => {
        expect(readHostname(' HTTPS://App.Acme.com/login?x=1 ')).toEqual({ hostname: 'app.acme.com', problem: null })
        expect(readHostname('app.acme.com.')).toEqual({ hostname: 'app.acme.com', problem: null })
        expect(readHostname('app.acme.com:8443')).toEqual({ hostname: 'app.acme.com', problem: null })
    })

    it('refuses a bare domain, which cannot hold a CNAME', () => {
        expect(readHostname('acme.com')).toEqual({ hostname: 'acme.com', problem: 'apex' })
    })

    it.each(['', 'acme', 'app..acme.com', '-app.acme.com', 'app_1.acme.com', '203.0.113.7', 'app.acme.c', 'a b.acme.com', '*.acme.com'])('refuses %j', value => {
        expect(readHostname(value).problem).toBe('invalid')
    })
})

describe('brandProblems', () => {
    it('accepts a complete brand and one with only a name', () => {
        expect(brandProblems(FIELDS)).toEqual({})
        expect(brandProblems({ name: 'A', color: '', supportEmail: '', docsUrl: '', termsUrl: '', privacyUrl: '' })).toEqual({})
    })

    it.each(['', '   ', 'x'.repeat(41), 'Nord{lys}', 'Nord<lys', 'Nord#1', 'a|b'])('refuses the name %j', name => {
        expect(brandProblems({ ...FIELDS, name })).toEqual({ name: 'nameInvalid' })
    })

    it('refuses a half typed color, email and address', () => {
        expect(brandProblems({ ...FIELDS, color: '#12', supportEmail: 'help@', docsUrl: 'http://help.com', termsUrl: 'help.com', privacyUrl: 'javascript:alert(1)' })).toEqual({ color: 'colorInvalid', supportEmail: 'emailInvalid', docsUrl: 'urlInvalid', termsUrl: 'urlInvalid', privacyUrl: 'urlInvalid' })
    })

    it('only takes https', () => {
        expect(isHttpsUrl('https://acme.com')).toBe(true)
        expect(isHttpsUrl('ftp://acme.com')).toBe(false)
    })

    it('refuses what the database would: a link not written https://, a name with a control character', () => {
        for (const link of ['HTTPS://acme.com', 'https:acme.com', 'http://acme.com']) expect(isHttpsUrl(link), link).toBe(false)
        expect(brandProblems({ ...FIELDS, name: 'Nord\u0007lys' })).toEqual({ name: 'nameInvalid' })
    })
})

describe('iconProblem', () => {
    const png = { type: 'image/png', size: 20_000 }
    it('takes a square of 512 px and up', () => {
        expect(iconProblem(png, 512, 512)).toBeNull()
        expect(iconProblem(png, 2048, 2048)).toBeNull()
    })

    it('says what is wrong', () => {
        expect(iconProblem(png, 512, 400)?.kind).toBe('notSquare')
        expect(iconProblem(png, 511, 511)?.kind).toBe('tooSmall')
        expect(iconProblem({ ...png, size: 9 * 1024 * 1024 }, 512, 512)?.kind).toBe('tooLarge')
        expect(iconProblem({ ...png, type: 'image/svg+xml' }, 512, 512)?.kind).toBe('type')
    })
})
