import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-db-tool-'))
process.env.RERUN_API_KEY = ''

const { beforeAll, describe, expect, it } = await import('vitest')
const { dbTools } = await import('./db.js')

const tools = dbTools({ agent: { id: 'db-agent' } } as any)

async function run(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = tools[name] as any
    return (await tool.execute(tool.inputSchema.parse(args), { toolCallId: 'c', messages: [] })) as string
}

describe('db_schema on a fresh agent', () => {
    it('says the database has no tables yet', async () => {
        expect(await run('db_schema', {})).toBe('Your database has no tables yet. Create one with db_execute (CREATE TABLE ...).')
    })
})

describe('db tools', () => {
    beforeAll(async () => {
        expect(await run('db_execute', { sql: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL, n INTEGER)' })).toBe('OK, 1 statement(s), 0 row(s) affected, lastInsertRowid=0')
    })

    it('inserts with bound params and reports the new rowid', async () => {
        expect(await run('db_execute', { sql: 'INSERT INTO notes (body, n) VALUES (?, ?)', params: ['first', 1] })).toBe('OK, 1 statement(s), 1 row(s) affected, lastInsertRowid=1')
        expect(await run('db_query', { sql: 'SELECT body, n FROM notes WHERE n = ?', params: [1] })).toBe('1 row(s)\n[{"body":"first","n":1}]')
    })

    it('runs a list of statements in one transaction and rolls all of them back on a failure', async () => {
        expect(
            await run('db_execute', {
                statements: [
                    { sql: 'INSERT INTO notes (body, n) VALUES (?, ?)', params: ['a', 10] },
                    { sql: 'INSERT INTO notes (body, n) VALUES (?, ?)', params: ['b', 11] },
                ],
            }),
        ).toBe('OK, 2 statement(s), 2 row(s) affected')

        const failed = await run('db_execute', {
            statements: [
                { sql: "INSERT INTO notes (body, n) VALUES ('rolled back', 20)" },
                { sql: 'INSERT INTO notes (body, n) VALUES (NULL, 21)' },
            ],
        })
        expect(failed).toMatch(/^Execution failed: .*NOT NULL/)
        expect(await run('db_query', { sql: 'SELECT count(*) AS c FROM notes WHERE n >= 20' })).toBe('1 row(s)\n[{"c":0}]')
    })

    it('refuses sql and statements together and runs neither, instead of dropping sql', async () => {
        const out = await run('db_execute', {
            sql: 'CREATE TABLE IF NOT EXISTS books (asin TEXT PRIMARY KEY, title TEXT)',
            statements: [{ sql: 'INSERT INTO books (asin, title) VALUES (?, ?)', params: ['0486220311', 'Chemistry Experiments for Children'] }],
        })
        expect(out).toBe('Execution failed: Pass either sql or statements, not both: nothing was run. Put every statement in statements, in the order they must run.')
        expect(await run('db_schema', {})).not.toMatch(/books/)
    })

    it('asks for sql or statements when it gets neither', async () => {
        expect(await run('db_execute', {})).toBe('Execution failed: Provide either sql or statements.')
        expect(await run('db_execute', { statements: [] })).toBe('Execution failed: Provide either sql or statements.')
    })

    it('refuses ATTACH on both tools', async () => {
        expect(await run('db_query', { sql: "ATTACH DATABASE '/etc/x.db' AS other" })).toBe('Query failed: ATTACH is not allowed. Each database is reached through its own tools.')
        expect(await run('db_execute', { sql: "attach '/tmp/other.db' as o" })).toMatch(/^Execution failed: ATTACH is not allowed/)
        expect(await run('db_execute', { statements: [{ sql: 'SELECT 1' }, { sql: "ATTACH 'x' AS y" }] })).toMatch(/^Execution failed: ATTACH is not allowed/)
    })

    it('refuses the file functions on both tools', async () => {
        expect(await run('db_query', { sql: "SELECT readfile('/etc/passwd') AS v" })).toBe('Query failed: File access is not allowed in SQL.')
        expect(await run('db_execute', { sql: "SELECT writefile('/tmp/pwned', 'x')" })).toBe('Execution failed: File access is not allowed in SQL.')
    })

    it('lets the word attach sit inside a string literal', async () => {
        expect(await run('db_query', { sql: "SELECT 'attach me' AS s" })).toBe('1 row(s)\n[{"s":"attach me"}]')
    })

    it('notes how many rows the limit cut', async () => {
        const out = await run('db_query', { sql: 'WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM r WHERE x < 5) SELECT x FROM r', limit: 2 })
        expect(out).toBe('5 row(s)\n[{"x":1},{"x":2}]\n[truncated to 2 of 5 rows]')
    })

    it('caps the output at 50k characters', async () => {
        const out = await run('db_query', { sql: "SELECT printf('%.*c', 2000, 'y') AS v FROM (WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM r WHERE x < 40) SELECT x FROM r)", limit: 1000 })
        expect(out).toHaveLength(50_000)
        expect(out.startsWith('40 row(s)\n')).toBe(true)
    })

    it('returns SQL errors as text', async () => {
        expect(await run('db_query', { sql: 'SELECT * FROM missing' })).toMatch(/^Query failed: .*no such table: missing/)
        expect(await run('db_execute', { sql: 'NOT SQL' })).toMatch(/^Execution failed: .*syntax error/)
    })

    // Looks wrong: the tool is described as read-only, yet it runs a DELETE because it only refuses ATTACH.
    it('runs a DELETE through db_query', async () => {
        await run('db_execute', { sql: "INSERT INTO notes (body, n) VALUES ('doomed', 99)" })
        expect(await run('db_query', { sql: 'DELETE FROM notes WHERE n = 99' })).toBe('0 row(s)\n[]')
        expect(await run('db_query', { sql: 'SELECT count(*) AS c FROM notes WHERE n = 99' })).toBe('1 row(s)\n[{"c":0}]')
    })

    it('shows the tables with their columns', async () => {
        expect(await run('db_schema', {})).toBe('notes(id INTEGER PK, body TEXT NOT NULL, n INTEGER)')
    })
})
