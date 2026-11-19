import { describe, expect, it } from 'vitest'

import { coworkerFaces, matchesVaultQuery, usedBySummary, vaultGroupOf, type UsedByText } from './vault-text'

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

describe('coworkerFaces', () => {
    it('draws everyone as one mark, whoever is attached', () => {
        expect(coworkerFaces({ sharedWithAll: true, coworkers: [coworker('Alice')], hiddenCoworkers: 2 }, 3)).toEqual({ everyone: true, ids: [], more: 0 })
    })

    it('shows the first coworkers and counts the rest, the hidden ones included', () => {
        expect(coworkerFaces({ sharedWithAll: false, coworkers: [], hiddenCoworkers: 0 }, 3)).toEqual({ everyone: false, ids: [], more: 0 })
        expect(coworkerFaces({ sharedWithAll: false, coworkers: [coworker('Alice'), coworker('Bob')], hiddenCoworkers: 0 }, 3)).toEqual({ everyone: false, ids: ['Alice', 'Bob'], more: 0 })
        const four = [coworker('Alice'), coworker('Bob'), coworker('Carol'), coworker('Dan')]
        expect(coworkerFaces({ sharedWithAll: false, coworkers: four, hiddenCoworkers: 2 }, 3)).toEqual({ everyone: false, ids: ['Alice', 'Bob', 'Carol'], more: 3 })
        expect(coworkerFaces({ sharedWithAll: false, coworkers: [], hiddenCoworkers: 2 }, 3)).toEqual({ everyone: false, ids: [], more: 2 })
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

    it('finds an account by the name it was given', () => {
        expect(matchesVaultQuery({ ...entry, customLabel: 'Acme org' }, 'acme org')).toBe(true)
    })
})
