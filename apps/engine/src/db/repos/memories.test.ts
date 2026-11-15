import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-memories-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it } = await import('vitest')
const { getSystemDb, systemDbExists } = await import('../systemDb.js')
const { bumpMemoryAccess, deleteMemoriesForAgent, deleteMemory, ftsRecall, indexMemory, listMemories, reindexMemory, vectorRecall } = await import('./memories.js')
import type { MemoryIndexRow } from './memories.js'

function memory(agentId: string, id: string, content: string, createdAt = '2026-09-01T00:00:00.000Z'): MemoryIndexRow {
    return { id, agentId, path: `${id}.md`, content, kind: 'note', createdAt, lastAccessedAt: null, accessCount: 0 }
}

function axis(index: number): number[] {
    const embedding = new Array<number>(1536).fill(0)
    embedding[index] = 1
    return embedding
}

async function ftsRows(agentId: string, id: string) {
    const { client } = await getSystemDb(agentId)
    const res = await client.execute({ sql: 'SELECT content FROM memories_fts WHERE memory_id = ?', args: [id] })
    return res.rows.map(row => String(row.content))
}

describe('ftsRecall', () => {
    it('returns nothing and never opens the db when no term survives', async () => {
        expect(await ftsRecall('untouched', '', 5)).toEqual([])
        expect(await ftsRecall('untouched', '?! a b . - x', 5)).toEqual([])
        expect(systemDbExists('untouched')).toBe(false)
    })

    it('strips punctuation, lowercases and ORs the terms', async () => {
        await indexMemory(memory('fts', 'invoice', 'The invoice for ACME is overdue'), null)
        await indexMemory(memory('fts', 'weather', 'Paris weather is sunny'), null)
        await indexMemory(memory('fts-other', 'foreign', 'Another invoice elsewhere'), null)

        const hits = await ftsRecall('fts', 'INVOICE?! "or" (sunny) AND a', 10)
        expect(hits.map(hit => hit.id).sort()).toEqual(['invoice', 'weather'])
        expect(hits.every(hit => typeof hit.score === 'number')).toBe(true)
        expect(hits[0]).toMatchObject({ agentId: 'fts', kind: 'note', accessCount: 0 })
    })

    it('limits the hits to k', async () => {
        expect(await ftsRecall('fts', 'invoice weather', 1)).toHaveLength(1)
    })

    it('finds a word with an accent or in a non-latin script', async () => {
        await indexMemory(memory('accents', 'cafe', 'Rendez-vous au café'), null)
        await indexMemory(memory('accents', 'moscow', 'Офис находится в Москве'), null)
        expect((await ftsRecall('accents', 'café', 5)).map(hit => hit.id)).toEqual(['cafe'])
        expect((await ftsRecall('accents', 'CAFE', 5)).map(hit => hit.id)).toEqual(['cafe'])
        expect((await ftsRecall('accents', 'Москве', 5)).map(hit => hit.id)).toEqual(['moscow'])
    })

    it('ignores the glue words of a question, in the query and nowhere else', async () => {
        await indexMemory(memory('stop', 'glue', 'What is the name of the tool'), null)
        expect(await ftsRecall('stop', 'what is the', 5)).toEqual([])
        expect(await ftsRecall('stop', "qu'est-ce que c'est", 5)).toEqual([])
        expect((await ftsRecall('stop', 'what is the tool', 5)).map(hit => hit.id)).toEqual(['glue'])
    })

    it('reports the share of the query terms each hit contains', async () => {
        await indexMemory(memory('coverage', 'full', 'Norvik Logistics renews in March'), null)
        await indexMemory(memory('coverage', 'partial', 'The Logistics team is in Lisbon'), null)
        const hits = await ftsRecall('coverage', 'the Norvik Logistics renewal', 5)
        expect(Object.fromEntries(hits.map(hit => [hit.id, hit.coverage]))).toEqual({ full: 2 / 3, partial: 1 / 3 })
    })

    it('carries the cosine to the query when both sides have a vector', async () => {
        await indexMemory(memory('fts-cos', 'with', 'invoice with a vector'), axis(0))
        await indexMemory(memory('fts-cos', 'without', 'invoice without a vector'), null)
        const similarity = async (embedding: number[] | null) => Object.fromEntries((await ftsRecall('fts-cos', 'invoice', 5, embedding)).map(hit => [hit.id, hit.similarity]))
        expect(await similarity(axis(0))).toEqual({ with: 1, without: null })
        expect(await similarity(null)).toEqual({ with: null, without: null })
    })
})

describe('reindexMemory', () => {
    it('rewrites the content in both the table and the search index', async () => {
        await indexMemory(memory('re', 'm1', 'old wording'), null)
        await reindexMemory({ ...memory('re', 'm1', 'fresh wording'), kind: 'fact' }, null)

        const [row] = await listMemories('re')
        expect(row).toMatchObject({ id: 'm1', content: 'fresh wording', kind: 'fact' })
        expect(row.lastAccessedAt).not.toBeNull()
        expect(await ftsRows('re', 'm1')).toEqual(['fresh wording'])
        expect(await ftsRecall('re', 'old', 5)).toEqual([])
        expect((await ftsRecall('re', 'fresh', 5)).map(hit => hit.id)).toEqual(['m1'])
    })

    it('replaces the embedding when one is given', async () => {
        await indexMemory(memory('re-vec', 'v1', 'first'), axis(0))
        await indexMemory(memory('re-vec', 'v2', 'second'), axis(1))
        await reindexMemory(memory('re-vec', 'v1', 'first moved'), axis(2))

        const hits = await vectorRecall('re-vec', axis(2), 1)
        expect(hits.map(hit => hit.id)).toEqual(['v1'])
        expect(hits[0].content).toBe('first moved')
    })
})

describe('deleteMemory', () => {
    it('removes the row and its search entry', async () => {
        await indexMemory(memory('del', 'gone', 'forget me'), null)
        await indexMemory(memory('del', 'kept', 'keep me'), null)

        await deleteMemory('del', 'gone')

        expect((await listMemories('del')).map(row => row.id)).toEqual(['kept'])
        expect(await ftsRows('del', 'gone')).toEqual([])
        expect(await ftsRows('del', 'kept')).toEqual(['keep me'])
    })
})

describe('deleteMemoriesForAgent', () => {
    it('removes every memory of the agent', async () => {
        await indexMemory(memory('wipe', 'a', 'alpha note'), null)
        await indexMemory(memory('wipe', 'b', 'beta note'), null)

        await deleteMemoriesForAgent('wipe')

        expect(await listMemories('wipe')).toEqual([])
        expect(await ftsRecall('wipe', 'note', 5)).toEqual([])
    })

    it('leaves the search index rows behind', async () => {
        await indexMemory(memory('orphan', 'a', 'orphan text'), null)
        await deleteMemoriesForAgent('orphan')
        expect(await ftsRows('orphan', 'a')).toEqual(['orphan text'])
    })
})

describe('listMemories and bumpMemoryAccess', () => {
    it('reads a row written before the decay columns existed as never accessed', async () => {
        await indexMemory(memory('legacy-row', 'm1', 'kept from an older engine'), null)
        const { client } = await getSystemDb('legacy-row')
        await client.execute('UPDATE memories SET last_accessed_at = NULL')
        expect((await listMemories('legacy-row'))[0]).toMatchObject({ id: 'm1', lastAccessedAt: null, accessCount: 0 })
    })

    it('lists newest first and bumps the access count only in full mode', async () => {
        await indexMemory(memory('bump', 'old', 'old', '2026-09-01T00:00:00.000Z'), null)
        await indexMemory(memory('bump', 'new', 'new', '2026-09-02T00:00:00.000Z'), null)

        expect((await listMemories('bump')).map(row => row.id)).toEqual(['new', 'old'])

        await bumpMemoryAccess('bump', ['old'], 'full')
        await bumpMemoryAccess('bump', ['old', 'new'], 'touch')
        await bumpMemoryAccess('bump', [], 'full')

        const rows = Object.fromEntries((await listMemories('bump')).map(row => [row.id, row]))
        expect(rows.old.accessCount).toBe(1)
        expect(rows.new.accessCount).toBe(0)
        expect(rows.new.lastAccessedAt).not.toBe('2026-09-02T00:00:00.000Z')
    })
})

describe('vectorRecall', () => {
    it('ranks by cosine similarity within the agent', async () => {
        await indexMemory(memory('vec', 'x', 'x axis'), axis(0))
        await indexMemory(memory('vec', 'y', 'y axis'), axis(1))
        await indexMemory(memory('vec', 'none', 'no embedding'), null)

        const hits = await vectorRecall('vec', axis(0), 2)
        expect(hits.map(hit => hit.id)).toEqual(['x', 'y'])
        expect(hits[0].score).toBeCloseTo(1)
        expect(hits[1].score).toBeCloseTo(0)
    })
})
