import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-table-views-'))

const { beforeAll, describe, expect, it } = await import('vitest')
const { AGENT_HIDDEN_TABLES, getAgentDb, readAgentDbSchema } = await import('./agentDb.js')
const { exportTableRows, listTables, updateTableRow } = await import('./sqlStore.js')
const { deleteTableViews, deleteView, listViews, saveView, VIEWS_TABLE } = await import('./tableViews.js')
const { cardTools } = await import('../tools/builtin/cards.js')
const { tableCardSchema } = await import('@moldwright/contracts')

const AGENT = 'views-agent'
let client: Awaited<ReturnType<typeof getAgentDb>>

beforeAll(async () => {
    client = await getAgentDb(AGENT)
    await client.execute('CREATE TABLE deals (name TEXT, stage TEXT, amount INTEGER, note TEXT)')
    for (const [name, stage, amount] of [['A', 'New', 100], ['B', 'Won', 300], ['C', 'New', 50]] as const) {
        await client.execute({ sql: 'INSERT INTO deals (name, stage, amount) VALUES (?, ?, ?)', args: [name, stage, amount] })
    }
    await client.execute('CREATE TABLE keyed (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID')
})

describe('table views', () => {
    it('reads no view before the first one is saved', async () => {
        expect(await listViews(client, 'deals')).toEqual([])
    })

    it('appends, replaces under a taken name only when asked, and keeps creation order', async () => {
        const board = await saveView(client, 'deals', { name: 'Pipeline', layout: 'board', groupBy: 'stage', fields: { title: 'name' } })
        await saveView(client, 'deals', { name: 'Names', layout: 'list', fields: { title: 'name' } })
        await expect(saveView(client, 'deals', { name: 'Pipeline', layout: 'table' })).rejects.toThrow('already exists')
        const replaced = await saveView(client, 'deals', { name: 'Pipeline', layout: 'board', groupBy: 'stage', fields: { title: 'name', value: 'amount' } }, { replaceByName: true })
        expect(replaced.id).toBe(board.id)
        const views = await listViews(client, 'deals')
        expect(views.map(v => [v.name, v.position])).toEqual([['Pipeline', 0], ['Names', 1]])
        expect(views[0].fields).toEqual({ title: 'name', value: 'amount' })
    })

    it('renames by id and refuses a name another view holds', async () => {
        const [pipeline] = await listViews(client, 'deals')
        await expect(saveView(client, 'deals', { name: 'Names', layout: 'table' }, { id: pipeline.id })).rejects.toThrow('already exists')
        const renamed = await saveView(client, 'deals', { ...pipeline, name: 'Stages' }, { id: pipeline.id })
        expect(renamed.name).toBe('Stages')
    })

    it('refuses unknown columns and incomplete layouts', async () => {
        await expect(saveView(client, 'deals', { name: 'x', layout: 'list', fields: { title: 'nope' } })).rejects.toThrow('Unknown column "nope"')
        await expect(saveView(client, 'deals', { name: 'x', layout: 'gallery' })).rejects.toThrow('needs fields.title')
        await expect(saveView(client, 'deals', { name: 'x', layout: 'board', fields: { title: 'name' } })).rejects.toThrow('needs groupBy')
    })

    it('forgets a column dropped after the view was saved, and falls back to a table', async () => {
        await client.execute('CREATE TABLE temp_deals (name TEXT, stage TEXT)')
        await saveView(client, 'temp_deals', { name: 'Board', layout: 'board', groupBy: 'stage', fields: { title: 'name' }, sort: { column: 'stage', dir: 'asc' } })
        await client.execute('ALTER TABLE temp_deals DROP COLUMN stage')
        const [view] = await listViews(client, 'temp_deals')
        expect(view.layout).toBe('table')
        expect(view.groupBy).toBeUndefined()
        expect(view.sort).toBeUndefined()
        await deleteTableViews(client, 'temp_deals')
        expect(await listViews(client, 'temp_deals')).toEqual([])
    })

    it('keeps its own table out of every listing and names the views in the schema', async () => {
        expect((await listTables(client, AGENT_HIDDEN_TABLES)).map(t => t.name)).not.toContain(VIEWS_TABLE)
        expect(await readAgentDbSchema(AGENT)).toContain('views: Stages (board), Names (list)')
    })

    it('deletes by name', async () => {
        await saveView(client, 'deals', { name: 'Doomed', layout: 'table' })
        expect(await deleteView(client, 'deals', 'Doomed')).toBe(true)
        expect(await deleteView(client, 'deals', 'Doomed')).toBe(false)
    })
})

describe('the agent tools', () => {
    const tools = cardTools({ agent: { id: AGENT } } as any)
    async function run(name: string, args: Record<string, unknown>): Promise<string> {
        const tool = tools[name] as any
        return (await tool.execute(tool.inputSchema.parse(args), {} as any)) as string
    }

    it('saves a view and draws a card from it by name', async () => {
        expect(await run('table_view_save', { scope: 'agent', table: 'deals', name: 'Top', layout: 'list', fields: { title: 'name' }, sort: { column: 'amount', dir: 'desc' } })).toContain('Saved the list view "Top"')
        const card = tableCardSchema.parse(JSON.parse(await run('card_table', { scope: 'agent', table: 'deals', view: 'top', limit: 1 })))
        expect(card.layout).toBe('list')
        expect(card.view).toBe('Top')
        expect(card.rows).toEqual([{ name: 'B' }])
    })

    it('names the existing views when the one asked for is missing', async () => {
        expect(await run('card_table', { scope: 'agent', table: 'deals', view: 'Ghost' })).toContain('Its views: Stages, Names, Top')
    })

    it('deletes a view by name', async () => {
        expect(await run('table_view_delete', { scope: 'agent', table: 'deals', name: 'Top' })).toContain('Deleted')
    })
})

describe('updateTableRow', () => {
    it('updates the named columns and returns the row read back', async () => {
        const row = await updateTableRow(client, 'deals', 1, { stage: 'Won', amount: 120 })
        expect(row).toMatchObject({ __rowid: 1, name: 'A', stage: 'Won', amount: 120 })
    })

    it('refuses an unknown column, a missing row and a table without rowid', async () => {
        await expect(updateTableRow(client, 'deals', 1, { nope: 1 })).rejects.toThrow('Column not found: nope')
        await expect(updateTableRow(client, 'deals', 999, { stage: 'x' })).rejects.toThrow('Row not found')
        await expect(updateTableRow(client, 'keyed', 1, { v: 'x' })).rejects.toThrow('no rowid')
    })

    it('refuses the hidden views table', async () => {
        await expect(updateTableRow(client, VIEWS_TABLE, 1, { name: 'x' }, AGENT_HIDDEN_TABLES)).rejects.toThrow('Table not found')
    })
})

describe('exportTableRows', () => {
    it('keeps only the rows matching the filter of a view', async () => {
        const { rows } = await exportTableRows(client, 'deals', { where: [{ column: 'stage', equals: 'New' }] })
        expect(rows.map(row => row.name)).toEqual(['C'])
    })
})
