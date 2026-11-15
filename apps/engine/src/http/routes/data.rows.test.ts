import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-data-rows-'))
process.env.RERUN_API_KEY = ''

const { describe, expect, it, beforeAll } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { agentDir } = await import('../../config/paths.js')

const id = 'rowsagent'
const app = createServer()
const base = `/agents/${id}/data`

type Rows = { columns: string[]; rows: Record<string, unknown>[]; total: number }

async function execute(sql: string, params: unknown[] = []) {
    const res = await app.request(`${base}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) })
    expect(res.status).toBe(200)
}

async function rows(table: string, query = ''): Promise<Rows> {
    const res = await app.request(`${base}/tables/${table}/rows${query}`)
    expect(res.status).toBe(200)
    return (await res.json()) as Rows
}

function deleteRows(table: string, body?: string) {
    return app.request(`${base}/tables/${table}/rows`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body })
}

async function count(table: string): Promise<number> {
    return (await rows(table)).total
}

beforeAll(async () => {
    await mkdir(agentDir(id), { recursive: true })
    await writeAgentConfig(id, agentConfigSchema.parse({ name: 'rows' }))
    await execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, colour TEXT)')
    await execute("INSERT INTO items (id, name, colour) WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 600) SELECT x, 'item-' || x, CASE WHEN x % 2 = 0 THEN 'red' ELSE 'blue' END FROM n")
})

describe('reading table rows', () => {
    it('pages 50 rows by default and reports the total', async () => {
        const page = await rows('items', '?sort=id')
        expect(page.total).toBe(600)
        expect(page.rows).toHaveLength(50)
        expect(page.columns).toEqual(['id', 'name', 'colour'])
    })

    it('clamps the limit between 1 and 500', async () => {
        expect((await rows('items', '?limit=1000')).rows).toHaveLength(500)
        expect((await rows('items', '?limit=-3')).rows).toHaveLength(1)
        expect((await rows('items', '?limit=7')).rows).toHaveLength(7)
    })

    it('falls back to 50 on a limit of zero or one that is not a number', async () => {
        expect((await rows('items', '?limit=0')).rows).toHaveLength(50)
        expect((await rows('items', '?limit=many')).rows).toHaveLength(50)
    })

    it('skips rows with an offset and ignores a negative one', async () => {
        expect((await rows('items', '?sort=id&limit=2&offset=10')).rows.map(r => r.id)).toEqual([11, 12])
        expect((await rows('items', '?sort=id&limit=2&offset=-5')).rows.map(r => r.id)).toEqual([1, 2])
        expect((await rows('items', '?sort=id&limit=2&offset=nope')).rows.map(r => r.id)).toEqual([1, 2])
    })

    it('sorts in either direction', async () => {
        expect((await rows('items', '?sort=id&dir=desc&limit=2')).rows.map(r => r.id)).toEqual([600, 599])
    })

    it('projects the requested columns and ignores blank ones', async () => {
        expect((await rows('items', '?columns=name,%20,colour&limit=1')).columns).toEqual(['name', 'colour'])
        expect((await rows('items', '?columns=%20,%20&limit=1')).columns).toEqual(['id', 'name', 'colour'])
    })

    it('searches the rows', async () => {
        const page = await rows('items', '?q=item-599')
        expect(page.total).toBe(1)
        expect(page.rows[0].name).toBe('item-599')
    })

    it('answers 500 on a table that does not exist', async () => {
        expect((await app.request(`${base}/tables/nope/rows`)).status).toBe(500)
    })
})

describe('deleting rows', () => {
    beforeAll(async () => {
        await execute('CREATE TABLE doomed (id INTEGER PRIMARY KEY, label TEXT)')
        await execute("INSERT INTO doomed (id, label) VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd')")
    })

    it('deletes the rowids given as numbers or strings and drops anything else', async () => {
        const res = await deleteRows('doomed', JSON.stringify({ rowids: [1, '2', null, { id: 3 }, true] }))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ deleted: 2 })
        expect(await count('doomed')).toBe(2)
    })

    it.each([
        ['no body', undefined],
        ['a body that is not JSON', '{nope'],
        ['rowids that are not a list', JSON.stringify({ rowids: 3 })],
        ['an empty list', JSON.stringify({ rowids: [] })],
    ])('deletes nothing given %s', async (_, body) => {
        const res = await deleteRows('doomed', body)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ deleted: 0 })
        expect(await count('doomed')).toBe(2)
    })

    it('drops a whole table', async () => {
        const res = await app.request(`${base}/tables/doomed`, { method: 'DELETE' })
        expect(res.status).toBe(204)
        const { tables } = (await (await app.request(`${base}/tables`)).json()) as { tables: { name: string }[] }
        expect(tables.map(t => t.name)).not.toContain('doomed')
    })
})

describe('exporting a table', () => {
    beforeAll(async () => {
        await execute('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, note TEXT)')
        await execute('INSERT INTO people (id, name, note) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)', [1, 'Ada, Countess', 'said "hi"', 2, 'Bob', 'line one\nline two', 3, 'Cy', null])
    })

    it('exports CSV by default, quoting what needs it', async () => {
        const res = await app.request(`${base}/tables/people/export?sort=id`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="people.csv"')
        expect(await res.text()).toBe(['id,name,note', '1,"Ada, Countess","said ""hi"""', '2,Bob,"line one\nline two"', '3,Cy,'].join('\n'))
    })

    it('treats an unknown format as CSV', async () => {
        const res = await app.request(`${base}/tables/people/export?format=xml&columns=name&sort=id&dir=desc`)
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="people.csv"')
        expect(await res.text()).toBe(['name', 'Cy', 'Bob', '"Ada, Countess"'].join('\n'))
    })

    it('exports pretty JSON when asked', async () => {
        const res = await app.request(`${base}/tables/people/export?format=json&q=Bob`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
        expect(res.headers.get('content-disposition')).toBe('attachment; filename="people.json"')
        const text = await res.text()
        expect(JSON.parse(text)).toEqual([{ id: 2, name: 'Bob', note: 'line one\nline two' }])
        expect(text).toContain('\n  ')
    })
})
