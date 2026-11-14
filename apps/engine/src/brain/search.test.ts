import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-brain-search-'))
process.env.RERUN_API_KEY = ''

const embed = vi.hoisted(() => ({ down: false }))
vi.mock('../memory/embed.js', () => ({
    embedText: async (text: string) => {
        if (embed.down) return null
        if (text === 'broken vector') return [1, 2, 3]
        const meanings = [/price|pricing|tarif|charge|facture/i, /customer|client/i, /team|founder/i]
        const v = new Array(1536).fill(0)
        meanings.forEach((re, i) => {
            if (re.test(text)) v[i] = 1
        })
        if (v.every(x => x === 0)) v[100] = 1
        return v
    },
}))

const { describe, expect, it, beforeAll } = await import('vitest')
const { writePage } = await import('./pages.js')
const { embedPendingChunks } = await import('./embedding.js')
const { searchBrain, toMatchQuery } = await import('./search.js')

const filler = (word: string) => `${word} lorem ipsum `.repeat(30).trim()

beforeAll(async () => {
    const write = (slug: string, title: string, type: 'offering' | 'customer' | 'team' | 'note', content: string) => writePage(slug, { title, type, content, sources: [], baseHash: null, author: 'seed' })
    await write('offering', 'Offering', 'offering', `## Products\n${filler('widgets gadgets')}\n\n## Pricing\n${filler('starter plan 49 per month')}\n\nUsed by [[acme-corp]].`)
    await write('acme-corp', 'Acme Corp', 'customer', filler('a customer since 2024'))
    await write('team', 'Team', 'team', filler('two founders'))
    await write('onboarding', 'Onboarding', 'note', filler('la procédure d’accueil'))
    await embedPendingChunks()
})

describe('toMatchQuery', () => {
    it('keeps accented words whole and drops one-letter terms', () => {
        expect(toMatchQuery('La procédure, à suivre')).toBe('"la" OR "procédure" OR "suivre"')
        expect(toMatchQuery('? !')).toBe('')
    })
})

describe('searchBrain', () => {
    it('finds a passage by meaning alone and returns the right section, not the whole page', async () => {
        const { hits } = await searchBrain('how much do we charge', 3)
        expect(hits[0].slug).toBe('offering')
        expect(hits[0].passages[0].heading).toBe('Pricing')
    })

    it('finds a passage by keyword when the hub cannot embed the query', async () => {
        embed.down = true
        const { hits } = await searchBrain('procédure', 3)
        embed.down = false
        expect(hits.map(h => h.slug)).toEqual(['onboarding'])
    })

    it('shows a page once with at most two passages, and the pages linked to it', async () => {
        const { hits, related } = await searchBrain('widgets pricing plan', 5)
        expect(hits.filter(h => h.slug === 'offering')).toHaveLength(1)
        expect(hits.find(h => h.slug === 'offering')!.passages.length).toBeLessThanOrEqual(2)
        expect(related.concat(hits)).toEqual(expect.arrayContaining([expect.objectContaining({ slug: 'acme-corp' })]))
    })

    it('follows a link backwards too', async () => {
        embed.down = true
        const { hits, related } = await searchBrain('2024', 1)
        embed.down = false
        expect(hits[0].slug).toBe('acme-corp')
        expect(related).toEqual([{ slug: 'offering', title: 'Offering' }])
    })

    it('falls back to keywords when the vector query itself fails', async () => {
        const { hits } = await searchBrain('broken vector', 3)
        expect(hits).toEqual([])
    })

    it('returns nothing when nothing matches', async () => {
        embed.down = true
        expect(await searchBrain('zzzz', 3)).toEqual({ hits: [], related: [] })
        expect(await searchBrain('?', 3)).toEqual({ hits: [], related: [] })
        embed.down = false
    })
})
