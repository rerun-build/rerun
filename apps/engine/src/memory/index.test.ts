import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-memindex-'))
process.env.RERUN_API_KEY = ''

const { state } = vi.hoisted(() => ({
    state: {
        files: [] as Array<{ id: string; kind: string; tags: string[]; createdAt: string; updatedAt?: string; content: string; path: string }>,
        rows: [] as Array<{ id: string; kind: string; createdAt: string; lastAccessedAt: string | null; accessCount: number }> | Error,
    },
}))

vi.mock('./files.js', () => ({ listMemoryFiles: async () => state.files }))
vi.mock('../db/repos/memories.js', () => ({
    listMemories: async () => {
        if (state.rows instanceof Error) throw state.rows
        return state.rows
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { buildMemoryIndex } = await import('./index.js')

const recent = new Date().toISOString()
const longAgo = new Date(Date.now() - 400 * 24 * 3_600_000).toISOString()

const file = (id: string, content: string, createdAt = recent, updatedAt?: string, kind = 'note') => ({ id, kind, tags: [], createdAt, updatedAt, content, path: `/m/${id}.md` })
const row = (id: string, lastAccessedAt: string) => ({ id, kind: 'task', createdAt: lastAccessedAt, lastAccessedAt, accessCount: 0 })

const listed = (index: string) => index.split('\n').filter(l => l.startsWith('- '))

beforeEach(() => {
    state.files = []
    state.rows = []
})

describe('buildMemoryIndex', () => {
    it('is empty when the agent has no memory files', async () => {
        state.rows = [row('orphan', recent)]
        expect(await buildMemoryIndex('a')).toBe('')
    })

    it('lists active memories with their kind under the preamble', async () => {
        state.files = [file('m1', 'the office is in paris', recent, undefined, 'fact')]
        state.rows = [row('m1', recent)]
        const index = await buildMemoryIndex('a')
        expect(index.startsWith('This is an index of everything you have remembered.')).toBe(true)
        expect(listed(index)).toEqual(['- (fact) the office is in paris'])
        expect(index).not.toContain('dormant')
    })

    it('counts a file with no database row as active', async () => {
        state.files = [file('m1', 'not indexed yet')]
        expect(listed(await buildMemoryIndex('a'))).toEqual(['- (note) not indexed yet'])
    })

    it('still builds the index when the database read fails', async () => {
        state.files = [file('m1', 'survives a db error')]
        state.rows = new Error('db locked')
        expect(listed(await buildMemoryIndex('a'))).toEqual(['- (note) survives a db error'])
    })

    it('shows only the dormant note when every memory is dormant', async () => {
        state.files = [file('m1', 'old one'), file('m2', 'old two')]
        state.rows = [row('m1', longAgo), row('m2', longAgo)]
        const index = await buildMemoryIndex('a')
        expect(listed(index)).toEqual([])
        expect(index.endsWith('\n\n\n\n2 dormant memories are not listed; pass includeDormant to memory_recall to search them.')).toBe(true)
    })

    it('uses the singular for a single dormant memory', async () => {
        state.files = [file('m1', 'fresh'), file('m2', 'stale')]
        state.rows = [row('m1', recent), row('m2', longAgo)]
        const index = await buildMemoryIndex('a')
        expect(listed(index)).toEqual(['- (note) fresh'])
        expect(index).toContain('1 dormant memory is not listed;')
    })

    it('sorts oldest first by creation, whatever was updated since', async () => {
        state.files = [
            file('old', 'created long ago, never updated', '2026-01-01T00:00:00.000Z'),
            file('updated', 'created long ago, updated recently', '2025-06-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'),
            file('mid', 'created in february', '2026-02-01T00:00:00.000Z'),
        ]
        expect(listed(await buildMemoryIndex('a'))).toEqual(['- (note) created long ago, updated recently', '- (note) created long ago, never updated', '- (note) created in february'])
    })

    it('breaks a tie on creation by id, so two memories written in the same second keep their order', async () => {
        state.files = [file('b', 'second'), file('a', 'first')]
        expect(listed(await buildMemoryIndex('a'))).toEqual(['- (note) first', '- (note) second'])
    })

    it('uses the first non-empty line as the headline and cuts it at 120 characters', async () => {
        const long = 'x'.repeat(121)
        const exact = 'y'.repeat(120)
        state.files = [file('long', `\n   \n  ${long}  \nsecond line`, '2026-01-01T00:00:00.000Z'), file('exact', exact, '2026-02-01T00:00:00.000Z'), file('blank', '   ', '2026-03-01T00:00:00.000Z')]
        expect(listed(await buildMemoryIndex('a'))).toEqual([`- (note) ${'x'.repeat(117)}...`, `- (note) ${exact}`, '- (note) '])
    })
})
