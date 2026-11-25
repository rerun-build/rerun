import { describe, expect, it } from 'vitest'

import { isReservedSlug, slugProblem, suggestSlug } from './slugs'

describe('slugProblem', () => {
    it.each(['nordlys', 'agence-du-nord', 'a1b', '3d-studio', 'a'.repeat(40), 'testimonial', 'stagingground'])('takes %s', slug => {
        expect(slugProblem(slug)).toBeNull()
    })

    it.each(['', 'ab', 'a'.repeat(41), 'Nordlys', 'nord lys', 'nord_lys', '-nordlys', 'nordlys-', 'nord.lys', 'né', 'xn--nordlys', 'nord--lys', 'nordlys\n'])('refuses %j', slug => {
        expect(slugProblem(slug)).toBe('invalid')
    })

    it.each(['app', 'www', 'api', 'edge', 'mail', 'admin', 'docs', 'status', 'staging', 'test-1', 'test-2', 'test-30', 'send', 'rerun', 'rerun-build', 'rerun2', 'login', 'auth', 'support', 'edge-2'])('keeps %s for Rerun', slug => {
        expect(isReservedSlug(slug)).toBe(true)
        expect(slugProblem(slug)).toBe('reserved')
    })
})

describe('suggestSlug', () => {
    it.each([
        ['Agence du Nord', 'agence-du-nord'],
        ['  Éclair & Cie  ', 'eclair-cie'],
        ['Studio 3D!', 'studio-3d'],
        ['Rerun', ''],
        ['Support', ''],
        ['日本', ''],
        ['AB', ''],
        [`${'long name '.repeat(9)}`, 'long-name-long-name-long-name-long-name'],
    ])('%j: %j', (name, slug) => {
        expect(suggestSlug(name)).toBe(slug)
    })

    it('only suggests what is accepted', () => {
        for (const name of ['Nordlys', 'Agence du Nord', 'x'.repeat(90), '--a--b--c--']) expect(slugProblem(suggestSlug(name))).toBeNull()
    })
})
