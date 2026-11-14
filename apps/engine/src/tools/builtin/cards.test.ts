import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-cards-'))
process.env.RERUN_DATA_DIR = dataDir

const { beforeAll, describe, expect, it } = await import('vitest')
const { cardTools } = await import('./cards.js')
const { getAgentDb } = await import('../../db/agentDb.js')
const { getSharedDb, recordTableOwnership } = await import('../../db/sharedDb.js')
const { sharedDir, workspaceDir } = await import('../../config/paths.js')
const { tableCardSchema, fileCardSchema, CARD_MAX_CELL_CHARS, CARD_MAX_COLUMNS, CARD_MAX_MEDIA_CHARS } = await import('@rerun/contracts')

const AGENT = 'agent-cards'
const tools = cardTools({ agent: { id: AGENT } } as any)

async function run(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = tools[name] as any
    return (await tool.execute(tool.inputSchema.parse(args), {} as any)) as string
}

let savedViews = 0

async function card({ scope = 'agent', table, limit, ...view }: Record<string, unknown>) {
    const name = `View ${++savedViews}`
    expect(await run('table_view_save', { scope, table, name, ...view })).toContain('Saved')
    return tableCardSchema.parse(JSON.parse(await run('card_table', { scope, table, view: name, limit })))
}

beforeAll(async () => {
    const db = await getAgentDb(AGENT)
    await db.execute('CREATE TABLE contacts (name TEXT, company TEXT, note TEXT)')
    await db.execute({ sql: 'INSERT INTO contacts VALUES (?, ?, ?)', args: ['Amina', 'Northwind', 'x'.repeat(CARD_MAX_CELL_CHARS + 50)] })
    await db.execute({ sql: 'INSERT INTO contacts VALUES (?, ?, ?)', args: ['Tomás', 'Acme', null] })

    const wide = Array.from({ length: CARD_MAX_COLUMNS + 3 }, (_, i) => `c${i}`)
    await db.execute(`CREATE TABLE wide (${wide.map(c => `${c} TEXT`).join(', ')})`)
    await db.execute(`INSERT INTO wide VALUES (${wide.map(() => "'v'").join(', ')})`)
    await db.execute('CREATE TABLE unviewed (name TEXT)')

    const shared = await getSharedDb()
    await shared.execute('CREATE TABLE IF NOT EXISTS leads (email TEXT)')
    await shared.execute("INSERT INTO leads VALUES ('a@b.c')")
    await recordTableOwnership(shared, ['CREATE TABLE leads (email TEXT)'], 'someone')

    await db.execute('CREATE TABLE deals (name TEXT, company TEXT, stage TEXT, amount INTEGER, photo TEXT, note TEXT)')
    const stages = [...Array(6).fill('New'), ...Array(3).fill('Won'), ...Array(2).fill('Lost'), 'Proposal']
    for (const [i, stage] of stages.entries()) {
        await db.execute({ sql: 'INSERT INTO deals VALUES (?, ?, ?, ?, ?, ?)', args: [`Deal ${i}`, `Co ${i}`, stage, (i + 1) * 100, `https://cdn.example.com/${'p'.repeat(300)}/${i}.jpg`, null] })
    }
    await db.execute({ sql: 'INSERT INTO deals VALUES (?, ?, ?, ?, ?, ?)', args: ['Huge', 'Co', 'New', 1, `https://x.io/${'p'.repeat(CARD_MAX_MEDIA_CHARS)}`, null] })
    await db.execute({ sql: 'INSERT INTO deals VALUES (?, ?, ?, ?, ?, ?)', args: ['Local', 'Co', 'New', 1, resolve(workspaceDir(AGENT), 'images/local.png'), null] })

    mkdirSync(resolve(workspaceDir(AGENT), 'reports'), { recursive: true })
    writeFileSync(resolve(workspaceDir(AGENT), 'reports/summary.md'), '# hello')
    mkdirSync(resolve(workspaceDir(AGENT), 'shots'), { recursive: true })
    writeFileSync(resolve(workspaceDir(AGENT), 'shots/a.png'), 'a')
    writeFileSync(resolve(workspaceDir(AGENT), 'shots/b.png'), 'b')
    mkdirSync(resolve(sharedDir(), 'remakes'), { recursive: true })
    writeFileSync(resolve(sharedDir(), 'remakes/slide-1.png'), 'slide')
})

describe('card_table', () => {
    it('returns a card the UI contract accepts', async () => {
        const shown = await card({ table: 'contacts', limit: 5 })
        expect(shown.columns).toEqual(['name', 'company', 'note'])
        expect(shown.total).toBe(2)
        expect(shown.rows).toHaveLength(2)
        expect(shown.columnsTruncated).toBe(false)
    })

    it('drops the internal rowid from the rows', async () => {
        const shown = await card({ table: 'contacts', limit: 5 })
        for (const row of shown.rows) expect(Object.keys(row)).toEqual(shown.columns)
    })

    it('caps long cell values', async () => {
        const shown = await card({ table: 'contacts', limit: 5 })
        expect(String(shown.rows[0].note).length).toBeLessThanOrEqual(CARD_MAX_CELL_CHARS + 1)
    })

    it('caps the number of columns and says so', async () => {
        const shown = await card({ table: 'wide', limit: 5 })
        expect(shown.columns).toHaveLength(CARD_MAX_COLUMNS)
        expect(shown.columnsTruncated).toBe(true)
    })

    it('reads the shared database on the shared scope', async () => {
        const shown = await card({ scope: 'shared', table: 'leads', limit: 5 })
        expect(shown.scope).toBe('shared')
        expect(shown.total).toBe(1)
    })

    it('hides the shared bookkeeping table', async () => {
        expect(await run('card_table', { scope: 'shared', table: '_rerun_shared_tables', view: 'All' })).toContain('Could not show that table')
    })

    it('reports an unknown table instead of throwing', async () => {
        expect(await run('card_table', { scope: 'agent', table: 'nope', view: 'All' })).toContain('Could not show that table')
    })

    it('refuses a table without a saved view and says how to make one', async () => {
        const answer = await run('card_table', { scope: 'agent', table: 'unviewed', view: 'All' })
        expect(answer).toContain('unviewed has no saved view yet')
        expect(answer).toContain('table_view_save')
    })
})

describe('card_table layouts', () => {
    it('sends a table card with nothing but its rows and the view it came from', async () => {
        expect(await run('table_view_save', { scope: 'agent', table: 'contacts', name: 'Plain' })).toContain('Saved the table view "Plain"')
        const sent = JSON.parse(await run('card_table', { scope: 'agent', table: 'contacts', view: 'Plain', limit: 5 }))
        expect(Object.keys(sent).sort()).toEqual(['columns', 'columnsTruncated', 'kind', 'rows', 'scope', 'table', 'total', 'view'])
    })

    it('only carries the columns a list names', async () => {
        const list = await card({ table: 'deals', layout: 'list', fields: { title: 'name', badge: 'stage' } })
        expect(list.layout).toBe('list')
        expect(list.columns).toEqual(['name', 'stage'])
        expect(Object.keys(list.rows[0])).toEqual(['name', 'stage'])
        expect(list.columnsTruncated).toBe(false)
    })

    it('names the wrong column and lists the real ones', async () => {
        const answer = await run('table_view_save', { scope: 'agent', table: 'deals', name: 'Bad', layout: 'gallery', fields: { title: 'name', image: 'picture' } })
        expect(answer).toContain('Unknown column "picture" in fields.image')
        expect(answer).toContain('Columns of deals: name, company, stage, amount, photo, note')
    })

    it('refuses an unknown format and a layout without its title', async () => {
        expect(await run('table_view_save', { scope: 'agent', table: 'deals', name: 'Bad', formats: { amount: 'money' } })).toContain('Unknown format "money"')
        expect(await run('table_view_save', { scope: 'agent', table: 'deals', name: 'Bad', layout: 'list' })).toContain('needs fields.title')
    })

    it('refuses a board without groupBy', async () => {
        expect(await run('table_view_save', { scope: 'agent', table: 'deals', name: 'Bad', layout: 'board', fields: { title: 'name' } })).toContain('needs groupBy')
    })

    it('counts board columns over the whole table and sends a few cards under each', async () => {
        const board = await card({ table: 'deals', layout: 'board', groupBy: 'stage', fields: { title: 'name', value: 'amount' }, formats: { amount: 'currency:EUR' }, limit: 2 })
        expect(board.groups?.map(g => [g.value, g.total])).toEqual([
            ['New', 8],
            ['Won', 3],
            ['Lost', 2],
            ['Proposal', 1],
        ])
        expect(board.groups?.[1].sum).toBe(700 + 800 + 900)
        expect(board.rows.filter(row => row.stage === 'New')).toHaveLength(2)
        expect(board.rows).toHaveLength(2 + 2 + 2 + 1)
        expect(board.total).toBe(14)
    })

    it('orders board columns by the keys of tones', async () => {
        const board = await card({ table: 'deals', layout: 'board', groupBy: 'stage', fields: { title: 'name' }, tones: { Proposal: 'brand', Won: 'green', Lost: 'red' } })
        expect(board.groups?.map(g => g.value)).toEqual(['Proposal', 'Won', 'Lost', 'New'])
    })

    it('keeps image URLs whole, drops oversized ones and relativises workspace paths', async () => {
        const gallery = await card({ table: 'deals', layout: 'gallery', fields: { title: 'name', image: 'photo' }, limit: 20 })
        const photo = (name: string) => gallery.rows.find(row => row.name === name)?.photo
        expect(String(photo('Deal 0')).length).toBeGreaterThan(CARD_MAX_CELL_CHARS)
        expect(String(photo('Deal 0'))).toMatch(/0\.jpg$/)
        expect(photo('Huge')).toBeNull()
        expect(photo('Local')).toBe('images/local.png')
    })

    it('picks the rows with sort and where, and counts what matches', async () => {
        const top = await card({ table: 'deals', sort: { column: 'amount', dir: 'desc' }, limit: 2, columns: ['name', 'amount'] })
        expect(top.rows.map(row => row.amount)).toEqual([1200, 1100])
        const won = await card({ table: 'deals', where: [{ column: 'stage', equals: 'Won' }], columns: ['name', 'stage'] })
        expect(won.total).toBe(3)
        expect(won.rows.every(row => row.stage === 'Won')).toBe(true)
    })

    it('sorts on a column the card does not show', async () => {
        const list = await card({ table: 'deals', layout: 'list', fields: { title: 'name' }, sort: { column: 'amount', dir: 'desc' }, limit: 1 })
        expect(list.rows[0].name).toBe('Deal 11')
    })

    it('keeps the gallery display and drops it elsewhere', async () => {
        const gallery = await card({ table: 'deals', layout: 'gallery', fields: { title: 'name' }, display: { shape: 'portrait', arrangement: 'carousel' } })
        expect(gallery.display).toEqual({ shape: 'portrait', arrangement: 'carousel' })
        const list = await card({ table: 'deals', layout: 'list', fields: { title: 'name' }, display: { shape: 'portrait' } })
        expect(list.display).toBeUndefined()
    })
})

describe('table card contract', () => {
    const base = { kind: 'table', scope: 'agent', table: 't', columns: [], rows: [], total: 0, columnsTruncated: false }

    it('reads a card from before layouts, and a layout it does not know yet, as a table', () => {
        expect(tableCardSchema.parse(base).layout).toBeUndefined()
        expect(tableCardSchema.parse({ ...base, layout: 'calendar' }).layout).toBeUndefined()
    })

    it('falls back on a neutral tone it does not know', () => {
        expect(tableCardSchema.parse({ ...base, tones: { Won: 'green', Odd: 'pink' } }).tones).toEqual({ Won: 'green', Odd: 'neutral' })
    })
})

describe('card_file', () => {
    const show = async (files: unknown) => fileCardSchema.parse(JSON.parse(await run('card_file', { files })))

    it('returns a card with a workspace-relative path', async () => {
        const [file] = (await show([{ path: 'reports/summary.md' }])).files
        expect(file).toEqual({ path: 'reports/summary.md', name: 'summary.md', size: 7, scope: 'agent' })
    })

    it('relativises an absolute path inside the workspace', async () => {
        const [file] = (await show([{ path: resolve(workspaceDir(AGENT), 'reports/summary.md') }])).files
        expect(file.path).toBe('reports/summary.md')
    })

    it('shows every candidate of a choice in one card, in order', async () => {
        const card = await show([{ path: 'shots/b.png' }, { path: 'shots/a.png' }, { path: 'reports/summary.md' }])
        expect(card.files.map(f => f.path)).toEqual(['shots/b.png', 'shots/a.png', 'reports/summary.md'])
    })

    it('shows a file of the shared space', async () => {
        const [file] = (await show([{ path: 'remakes/slide-1.png', scope: 'shared' }])).files
        expect(file).toMatchObject({ path: 'remakes/slide-1.png', name: 'slide-1.png', scope: 'shared' })
    })

    it('reads an absolute shared path as shared whatever the scope given', async () => {
        const [file] = (await show([{ path: resolve(sharedDir(), 'remakes/slide-1.png') }])).files
        expect(file).toMatchObject({ path: 'remakes/slide-1.png', scope: 'shared' })
    })

    it('reads an absolute workspace path as agent whatever the scope given', async () => {
        const [file] = (await show([{ path: resolve(workspaceDir(AGENT), 'reports/summary.md'), scope: 'shared' }])).files
        expect(file).toMatchObject({ path: 'reports/summary.md', scope: 'agent' })
    })

    it('accepts the files array serialised as a string', async () => {
        const card = await show(JSON.stringify([{ path: 'shots/a.png' }]))
        expect(card.files).toHaveLength(1)
    })

    it('refuses a directory', async () => {
        expect(await run('card_file', { files: [{ path: 'reports' }] })).toContain('is a folder')
    })

    it('refuses a path outside the workspace', async () => {
        expect(await run('card_file', { files: [{ path: '../../escape.txt' }] })).toContain('Could not show that file')
    })

    it('refuses a path outside the shared space', async () => {
        expect(await run('card_file', { files: [{ path: '../shared-db/shared.db', scope: 'shared' }] })).toContain('Could not show that file')
    })

    it('shows nothing when one of the files is missing, and names it', async () => {
        const result = await run('card_file', { files: [{ path: 'shots/a.png' }, { path: 'shots/nope.png' }, { path: 'shots/b.png' }] })
        expect(result).toContain('nothing was shown')
        expect(result).toContain('shots/nope.png')
        expect(result).not.toContain('shots/a.png:')
    })

    it('still reads a card sent before a card could carry several files', () => {
        const card = fileCardSchema.parse({ kind: 'file', path: 'reports/summary.md', name: 'summary.md', size: 7 })
        expect(card.files).toEqual([{ path: 'reports/summary.md', name: 'summary.md', size: 7, scope: 'agent' }])
    })
})
