import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-table-card-'))
process.env.RERUN_API_KEY = ''

const { beforeAll, describe, expect, it } = await import('vitest')
const { CARD_MAX_GROUPS, CARD_MAX_ROWS } = await import('@moldwright/contracts')
const { getAgentDb } = await import('../../db/agentDb.js')
const { workspaceDir } = await import('../../config/paths.js')
const { buildTableCard } = await import('./table-card.js')

const AGENT = 'table-card-agent'
const workspace = workspaceDir(AGENT)
let client: Awaited<ReturnType<typeof getAgentDb>>

function build(input: Record<string, unknown>) {
    return buildTableCard(client, { scope: 'agent', layout: 'table', ...input } as Parameters<typeof buildTableCard>[1], { hidden: [], workspace })
}

beforeAll(async () => {
    client = await getAgentDb(AGENT)
    await client.execute('CREATE TABLE tasks (title TEXT, stage TEXT, points REAL, share REAL)')
    const stages = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    for (const [i, stage] of stages.entries()) {
        for (let n = 0; n <= i; n++) await client.execute({ sql: 'INSERT INTO tasks VALUES (?, ?, ?, ?)', args: [`${stage}${n}`, stage, 2, 0.5] })
    }
    await client.execute({ sql: 'INSERT INTO tasks VALUES (?, NULL, 1, 0.1)', args: ['orphan'] })

    await client.execute('CREATE TABLE files (name TEXT, picture TEXT, link TEXT)')
    await client.execute({ sql: 'INSERT INTO files VALUES (?, ?, ?)', args: ['inside', resolve(workspace, 'img/a.png'), resolve(workspace, 'doc.pdf')] })
    await client.execute({ sql: 'INSERT INTO files VALUES (?, ?, ?)', args: ['lookalike', `${workspace}-evil/b.png`, null] })
    await client.execute({ sql: 'INSERT INTO files VALUES (?, ?, ?)', args: ['relative', 'img/c.png', 'https://x.io'] })
})

describe('buildTableCard boards', () => {
    it('shows at most six columns and splits the row budget between them', async () => {
        const card = await build({ table: 'tasks', layout: 'board', groupBy: 'stage', fields: { title: 'title' }, limit: CARD_MAX_ROWS })
        expect(card.groups).toHaveLength(CARD_MAX_GROUPS)
        expect(card.groups?.map(g => g.value)).toEqual(['g', 'f', 'e', 'd', 'c', 'b'])
        const perGroup = Math.floor(CARD_MAX_ROWS / CARD_MAX_GROUPS)
        for (const group of card.groups ?? []) expect(card.rows.filter(row => row.stage === group.value)).toHaveLength(Math.min(perGroup, group.total))
        expect(card.total).toBe(29)
    })

    it('gives a lone column the whole limit', async () => {
        const card = await build({ table: 'tasks', layout: 'board', groupBy: 'stage', fields: { title: 'title' }, where: [{ column: 'stage', equals: 'g' }], limit: CARD_MAX_ROWS })
        expect(card.groups).toEqual([{ value: 'g', total: 7 }])
        expect(card.rows).toHaveLength(7)
        expect(card.total).toBe(7)
    })

    it('sums the value column only when it is formatted as a number or a currency', async () => {
        const where = [{ column: 'stage', equals: 'c' }]
        const board = { table: 'tasks', layout: 'board', groupBy: 'stage', where }
        expect((await build({ ...board, fields: { title: 'title', value: 'points' }, formats: { points: 'number' } })).groups).toEqual([{ value: 'c', total: 3, sum: 6 }])
        expect((await build({ ...board, fields: { title: 'title', value: 'points' }, formats: { points: 'currency:USD' } })).groups?.[0].sum).toBe(6)
        expect((await build({ ...board, fields: { title: 'title', value: 'share' }, formats: { share: 'percent' } })).groups?.[0]).not.toHaveProperty('sum')
        expect((await build({ ...board, fields: { title: 'title', value: 'points' } })).groups?.[0]).not.toHaveProperty('sum')
    })

    it('labels the group of empty values with an empty string and still fills it', async () => {
        const card = await build({ table: 'tasks', layout: 'board', groupBy: 'stage', fields: { title: 'title' }, tones: { '': 'neutral' }, limit: 1 })
        expect(card.groups?.[0]).toEqual({ value: '', total: 1 })
        expect(card.rows.find(row => row.title === 'orphan')).toBeDefined()
    })

    it('breaks a tie in the tones order by size', async () => {
        const card = await build({ table: 'tasks', layout: 'board', groupBy: 'stage', fields: { title: 'title' }, tones: { b: 'green' } })
        expect(card.groups?.map(g => g.value)).toEqual(['b', 'g', 'f', 'e', 'd', 'c'])
    })

    it('refuses a groupBy column that does not exist', async () => {
        await expect(build({ table: 'tasks', layout: 'board', groupBy: 'phase', fields: { title: 'title' } })).rejects.toThrow('Unknown column "phase" in groupBy')
    })
})

describe('buildTableCard columns and filters', () => {
    it('names the unknown column of columns, where and sort', async () => {
        await expect(build({ table: 'tasks', columns: ['title', 'nope'] })).rejects.toThrow('Unknown column "nope" in columns. Columns of tasks: title, stage, points, share')
        await expect(build({ table: 'tasks', where: [{ column: 'nope', equals: 1 }] })).rejects.toThrow('Unknown column "nope" in where')
        await expect(build({ table: 'tasks', sort: { column: 'nope' } })).rejects.toThrow('Unknown column "nope" in sort')
        await expect(build({ table: 'tasks', formats: { nope: 'number' } })).rejects.toThrow('Unknown column "nope" in formats')
    })

    it('keeps only the formats of the columns it shows', async () => {
        const card = await build({ table: 'tasks', columns: ['title', 'points'], formats: { points: 'number', share: 'percent' } })
        expect(card.formats).toEqual({ points: 'number' })
        const bare = await build({ table: 'tasks', columns: ['title'], formats: { share: 'percent' } })
        expect(bare).not.toHaveProperty('formats')
    })
})

describe('buildTableCard media cells', () => {
    async function cells(input: Record<string, unknown>) {
        const card = await build({ table: 'files', limit: 10, ...input })
        return Object.fromEntries(card.rows.map(row => [row.name, row]))
    }

    it('relativises an image inside the workspace but not a sibling folder that shares its prefix', async () => {
        const rows = await cells({ layout: 'gallery', fields: { title: 'name', image: 'picture' } })
        expect(rows.inside.picture).toBe('img/a.png')
        expect(rows.lookalike.picture).toBe(`${workspace}-evil/b.png`)
        expect(rows.relative.picture).toBe('img/c.png')
    })

    it('relativises a column formatted as image in a table', async () => {
        const rows = await cells({ columns: ['name', 'picture'], formats: { picture: 'image' } })
        expect(rows.inside.picture).toBe('img/a.png')
    })

    it('leaves a url column whole and absolute', async () => {
        const rows = await cells({ columns: ['name', 'link'], formats: { link: 'url' } })
        expect(rows.inside.link).toBe(resolve(workspace, 'doc.pdf'))
        expect(rows.relative.link).toBe('https://x.io')
    })
})
