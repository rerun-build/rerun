import { describe, expect, it } from 'vitest'

import type { VaultItemSummary } from '@rerun/contracts'

import { matchesVaultQuery, usedBySummary, vaultAccountsFor, vaultGroupOf, type UsedByText } from './vault-text'

const text: UsedByText = {
    everyone: 'Every coworker',
    unused: 'No coworker yet',
    usedBy: names => names,
    usedByMore: (names, count) => `${names} and ${count} others`,
    hidden: count => `${count} hidden`,
}

const coworker = (name: string) => ({ id: name, engineAgentId: `e-${name}`, name, spaceId: 'box' })

describe('usedBySummary', () => {
    it('says everyone, nobody, the names, or the first names and how many more', () => {
        expect(usedBySummary({ sharedWithAll: true, coworkers: [coworker('Alice')], hiddenCoworkers: 0 }, text)).toBe('Every coworker')
        expect(usedBySummary({ sharedWithAll: false, coworkers: [], hiddenCoworkers: 0 }, text)).toBe('No coworker yet')
        expect(usedBySummary({ sharedWithAll: false, coworkers: [coworker('Alice'), coworker('Bob')], hiddenCoworkers: 0 }, text)).toBe('Alice, Bob')
        expect(usedBySummary({ sharedWithAll: false, coworkers: [coworker('Alice'), coworker('Bob'), coworker('Carol')], hiddenCoworkers: 1 }, text)).toBe('Alice, Bob and 2 others')
    })

    it('counts the coworkers the reader cannot see without naming them', () => {
        expect(usedBySummary({ sharedWithAll: false, coworkers: [], hiddenCoworkers: 3 }, text)).toBe('3 hidden')
    })
})

describe('vaultGroupOf', () => {
    it('puts catalog apps, paid apps included, under apps', () => {
        expect(vaultGroupOf({ kind: 'service' })).toBe('apps')
        expect(vaultGroupOf({ kind: 'mcp' })).toBe('mcp')
        expect(vaultGroupOf({ kind: 'secret' })).toBe('secrets')
    })
})

describe('matchesVaultQuery', () => {
    const entry = { name: 'Gmail', label: 'support@acme.test', slug: 'gmail', envKeys: ['GMAIL_TOKEN'], coworkers: [coworker('Alice')] }

    it('finds an entry by its name, account, app, variable or coworker, whatever the case', () => {
        for (const query of ['gmail', 'SUPPORT@', 'gmail_token', 'alice', '  ']) expect(matchesVaultQuery(entry, query)).toBe(true)
        expect(matchesVaultQuery(entry, 'notion')).toBe(false)
    })
})

describe('vaultAccountsFor', () => {
    const item = (over: Partial<VaultItemSummary>) => ({ id: 'x', kind: 'service', slug: 'gmail', name: 'Gmail', status: 'active', ...over }) as VaultItemSummary

    it('offers every signed-in account of the app, by its label', () => {
        const available = [item({ id: 'a', label: 'sales@acme.test' }), item({ id: 'b', label: 'ops@acme.test' }), item({ id: 'c' })]
        expect(vaultAccountsFor({ available }, 'gmail')).toEqual([
            { id: 'a', label: 'sales@acme.test' },
            { id: 'b', label: 'ops@acme.test' },
            { id: 'c', label: 'Gmail' },
        ])
    })

    it('leaves out other apps, signed-out accounts, secrets and a missing Vault', () => {
        const available = [item({ id: 'a', slug: 'slack' }), item({ id: 'b', status: 'needs_auth' }), item({ id: 'c', kind: 'secret', slug: undefined })]
        expect(vaultAccountsFor({ available }, 'gmail')).toEqual([])
        expect(vaultAccountsFor(null, 'gmail')).toEqual([])
    })
})
