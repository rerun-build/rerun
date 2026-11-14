import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-store-'))
process.env.RERUN_API_KEY = ''

const { vectors, embedFailures } = vi.hoisted(() => ({
    vectors: new Map<string, number[]>(),
    embedFailures: new Set<string>(),
}))

vi.mock('./embed.js', () => ({
    embedText: async (text: string) => {
        if (embedFailures.has(text)) throw new Error('hub unreachable')
        return vectors.get(text) ?? null
    },
}))

const { describe, expect, it } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { writeMemory, updateMemory, deleteMemory, deleteAllMemories, recallMemory } = await import('./store.js')
const { listMemoryFiles, memoryFileExists, readMemoryFile } = await import('./files.js')
const { ftsRecall, listMemories } = await import('../db/repos/memories.js')
const { getSystemDb } = await import('../db/systemDb.js')

import type { LoadedAgent } from '../agents/types.js'

const DIMS = 1536

function axis(i: number, sign = 1): number[] {
    const v = new Array(DIMS).fill(0)
    v[i] = sign
    return v
}

const agentNamed = (id: string) => ({ id }) as LoadedAgent

const memoryFilePath = (agentId: string, id: string) => resolve(process.env.RERUN_DATA_DIR!, 'agents', agentId, 'memory', `${id}.md`)

describe('writeMemory', () => {
    it('indexes the memory for full-text recall when there is no embedding', async () => {
        const agent = agentNamed('write-no-embed')
        const id = await writeMemory(agent, 'the invoices live in quickbooks', 'fact', ['billing'])
        const hits = await ftsRecall(agent.id, 'quickbooks', 5)
        expect(hits.map(h => h.id)).toEqual([id])
        const file = await readMemoryFile(memoryFilePath(agent.id, id))
        expect(file).toMatchObject({ id, kind: 'fact', tags: ['billing'], content: 'the invoices live in quickbooks' })
    })

    it('still indexes the memory when embedding throws', async () => {
        const agent = agentNamed('write-embed-throws')
        embedFailures.add('the payroll runs on gusto')
        const id = await writeMemory(agent, 'the payroll runs on gusto')
        expect((await ftsRecall(agent.id, 'gusto', 5)).map(h => h.id)).toEqual([id])
        const row = (await listMemories(agent.id)).find(r => r.id === id)
        expect(row?.kind).toBe('note')
    })
})

describe('updateMemory', () => {
    it('rewrites the file and the full-text index while keeping kind, tags and createdAt', async () => {
        const agent = agentNamed('update-agent')
        const id = await writeMemory(agent, 'the office is in lyon', 'fact', ['office'])
        const before = await readMemoryFile(memoryFilePath(agent.id, id))

        await updateMemory(agent, id, '  the office is in paris  ')

        const after = await readMemoryFile(memoryFilePath(agent.id, id))
        expect(after.content).toBe('the office is in paris')
        expect(after.kind).toBe('fact')
        expect(after.tags).toEqual(['office'])
        expect(after.createdAt).toBe(before.createdAt)
        expect(after.updatedAt).toBeTruthy()

        expect((await ftsRecall(agent.id, 'paris', 5)).map(h => h.id)).toEqual([id])
        expect(await ftsRecall(agent.id, 'lyon', 5)).toEqual([])
        expect((await listMemories(agent.id)).find(r => r.id === id)?.content).toBe('the office is in paris')
    })

    it('stores the new embedding so vector recall finds the updated memory', async () => {
        const agent = agentNamed('update-embed-agent')
        const id = await writeMemory(agent, 'the ceo is alice', 'fact')
        vectors.set('the ceo is bob', axis(3))
        vectors.set('leadership', axis(3))
        await updateMemory(agent, id, 'the ceo is bob')
        const hits = await recallMemory(agent, 'leadership', 5, { reinforce: 'none' })
        expect(hits.map(h => h.content)).toEqual(['the ceo is bob'])
    })

    it('throws when the memory file does not exist', async () => {
        const agent = agentNamed('update-missing')
        await expect(updateMemory(agent, 'nope', 'anything')).rejects.toThrow()
    })
})

describe('deleteMemory', () => {
    it('removes the file, the row and the full-text entry', async () => {
        const agent = agentNamed('delete-agent')
        const id = await writeMemory(agent, 'the wifi password is hunter2')
        await deleteMemory(agent, id)
        expect(memoryFileExists(agent.id, id)).toBe(false)
        expect((await listMemories(agent.id)).map(r => r.id)).not.toContain(id)
        expect(await ftsRecall(agent.id, 'hunter2', 5)).toEqual([])
    })

    it('still removes the row when the file is already gone', async () => {
        const agent = agentNamed('delete-missing-file')
        const id = await writeMemory(agent, 'a memory whose file vanished')
        await rm(memoryFilePath(agent.id, id))
        await deleteMemory(agent, id)
        expect(await listMemories(agent.id)).toEqual([])
    })

    it('swallows a file error for an invalid id', async () => {
        await expect(deleteMemory(agentNamed('delete-bad-id'), '../x')).resolves.toBeUndefined()
    })
})

describe('deleteAllMemories', () => {
    it('removes every file and row for the agent and leaves other agents alone', async () => {
        const agent = agentNamed('delete-all-agent')
        const other = agentNamed('delete-all-other')
        await writeMemory(agent, 'first memory about apples')
        await writeMemory(agent, 'second memory about pears')
        const kept = await writeMemory(other, 'a memory about apples too')

        await deleteAllMemories(agent)

        expect(await listMemoryFiles(agent.id)).toEqual([])
        expect(await listMemories(agent.id)).toEqual([])
        expect(await ftsRecall(agent.id, 'apples', 5)).toEqual([])
        expect((await listMemories(other.id)).map(r => r.id)).toEqual([kept])

        const { client } = await getSystemDb(agent.id)
        const leaked = await client.execute('SELECT count(*) AS n FROM memories_fts')
        expect(Number(leaked.rows[0].n)).toBe(2)
    })

    it('resolves when the agent has no memories at all', async () => {
        await expect(deleteAllMemories(agentNamed('delete-all-empty'))).resolves.toBeUndefined()
    })
})

describe('recallMemory', () => {
    it('merges a memory found by both vector and full-text search into one hit', async () => {
        const agent = agentNamed('recall-dedupe')
        vectors.set('orange zebra crossing', axis(0))
        vectors.set('zebra', axis(0))
        const both = await writeMemory(agent, 'orange zebra crossing')

        const hits = await recallMemory(agent, 'zebra', 5, { reinforce: 'none' })

        expect(hits.map(h => h.id)).toEqual([both])
    })

    it('ranks by meaning, so a memory sharing one common word does not outrank the one that answers', async () => {
        const agent = agentNamed('recall-semantic-first')
        vectors.set('refunds are accepted within 30 days', axis(0))
        vectors.set('the survey came back at 47', axis(1))
        vectors.set('money back guarantee', axis(0))
        const answer = await writeMemory(agent, 'refunds are accepted within 30 days')
        const lookalike = await writeMemory(agent, 'the survey came back at 47')

        const hits = await recallMemory(agent, 'money back guarantee', 5, { reinforce: 'none' })

        expect(hits.map(h => h.id)).toEqual([answer, lookalike])
    })

    it('lets an exact keyword match win between two memories equally close in meaning', async () => {
        const agent = agentNamed('recall-keyword-bonus')
        vectors.set('the migration is tracked under OPS-4471', axis(0))
        vectors.set('the audit is tracked under OPS-9000', axis(0))
        vectors.set('OPS-9000', axis(0))
        await writeMemory(agent, 'the migration is tracked under OPS-4471')
        const exact = await writeMemory(agent, 'the audit is tracked under OPS-9000')

        const hits = await recallMemory(agent, 'OPS-9000', 5, { reinforce: 'none' })

        expect(hits[0]?.id).toBe(exact)
    })

    it('drops the hits below the similarity floor and keeps those with no cosine at all', async () => {
        const agent = agentNamed('recall-floor')
        vectors.set('the office is in rotterdam', axis(0))
        vectors.set('the backend is written in elixir', axis(1))
        vectors.set('where is the office', axis(0))
        const close = await writeMemory(agent, 'the office is in rotterdam')
        await writeMemory(agent, 'the backend is written in elixir')
        const unembedded = await writeMemory(agent, 'the office closes at six')

        const hits = await recallMemory(agent, 'where is the office', 5, { reinforce: 'none', minSimilarity: 0.25 })

        expect(hits.map(h => h.id).sort()).toEqual([close, unembedded].sort())
        expect(await recallMemory(agent, 'where is the office', 5, { reinforce: 'none' })).toHaveLength(3)
    })

    it('does not refresh a memory the floor filtered out', async () => {
        const agent = agentNamed('recall-floor-no-touch')
        vectors.set('call the plumber', axis(0))
        vectors.set('hello', axis(1))
        const id = await writeMemory(agent, 'call the plumber', 'task')
        const before = (await listMemories(agent.id)).find(r => r.id === id)?.lastAccessedAt
        await new Promise(done => setTimeout(done, 5))

        expect(await recallMemory(agent, 'hello', 5, { reinforce: 'touch', minSimilarity: 0.25 })).toEqual([])

        expect((await listMemories(agent.id)).find(r => r.id === id)?.lastAccessedAt).toBe(before)
    })

    it('uses full-text search alone when embedding the query fails', async () => {
        const agent = agentNamed('recall-embed-fails')
        const id = await writeMemory(agent, 'the router is a ubiquiti')
        embedFailures.add('ubiquiti router')
        const hits = await recallMemory(agent, 'ubiquiti router', 5, { reinforce: 'none' })
        expect(hits.map(h => h.id)).toEqual([id])
    })

    it('returns at most k hits', async () => {
        const agent = agentNamed('recall-k')
        for (const word of ['one', 'two', 'three', 'four']) await writeMemory(agent, `shared keyword ${word}`)
        const hits = await recallMemory(agent, 'keyword', 2, { reinforce: 'none' })
        expect(hits).toHaveLength(2)
    })

    it('falls back to the indexed content and empty tags when the file is missing', async () => {
        const agent = agentNamed('recall-missing-file')
        const id = await writeMemory(agent, 'the printer is on floor three', 'fact', ['office'])
        await rm(memoryFilePath(agent.id, id))
        const [hit] = await recallMemory(agent, 'printer floor', 5, { reinforce: 'none' })
        expect(hit).toMatchObject({ id, content: 'the printer is on floor three', kind: 'fact', tags: [] })
    })

    it('returns nothing when no memory matches', async () => {
        const agent = agentNamed('recall-empty')
        expect(await recallMemory(agent, 'anything at all', 5)).toEqual([])
    })
})
