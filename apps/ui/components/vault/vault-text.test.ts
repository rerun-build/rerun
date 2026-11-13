import { describe, expect, it } from 'vitest'

import { matchesVaultQuery, usedBySummary, vaultGroupOf, type UsedByText } from './vault-text'

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
