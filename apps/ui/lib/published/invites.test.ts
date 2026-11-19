import { describe, expect, it } from 'vitest'
import { normalizeInvites } from './invites'

describe('normalizeInvites', () => {
    it('lowercases, dedupes and reads a bare domain as one', () => {
        expect(normalizeInvites([' Marie@Northwind.com', 'marie@northwind.com', 'northwind.com', '@globex.io', ''])).toEqual(['marie@northwind.com', '@northwind.com', '@globex.io'])
    })

    it('refuses what is neither an email nor a domain', () => {
        expect(() => normalizeInvites(['marie'])).toThrow('Not an email or a domain: marie')
        expect(() => normalizeInvites(['@nodot'])).toThrow()
    })
})
