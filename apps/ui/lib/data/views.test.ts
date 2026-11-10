import { describe, expect, it } from 'vitest'
import { boardColumns, coerceCellInput } from '@/lib/data/views'
import { formValuesToInput, NONE, previewCard, quickViewInput, viewToFormValues } from '@/lib/data/view-form'

const column = (type: string, notnull = false) => ({ name: 'c', type, pk: false, notnull })

describe('coerceCellInput', () => {
    it('keeps numbers numbers in numeric columns and text elsewhere', () => {
        expect(coerceCellInput('42', column('INTEGER'))).toBe(42)
        expect(coerceCellInput('4.5', column('REAL'))).toBe(4.5)
        expect(coerceCellInput('4.5', column('INTEGER'))).toBe('4.5')
        expect(coerceCellInput('42', column('TEXT'))).toBe('42')
        expect(coerceCellInput('yes', column('BOOLEAN'))).toBe(1)
    })

    it('turns an empty field into NULL unless the column refuses it', () => {
        expect(coerceCellInput('', column('TEXT'))).toBeNull()
        expect(coerceCellInput('', column('TEXT', true))).toBe('')
    })
})

describe('boardColumns', () => {
    it('puts the toned values first, in order, and keeps them when empty', () => {
        const columns = boardColumns(
            [
                { value: 'New', total: 5 },
                { value: 'Won', total: 2 },
                { value: null, total: 1 },
            ],
            { Lead: 'brand', Won: 'green' },
        )
        expect(columns.map(c => [c.label, c.total])).toEqual([
            ['Lead', 0],
            ['Won', 2],
            ['New', 5],
            ['', 1],
        ])
    })
})

describe('view form', () => {
    it('round-trips a board and keeps the filter the agent saved', () => {
        const view = { id: 'v', table: 't', name: 'Pipeline', position: 0, layout: 'board' as const, groupBy: 'stage', fields: { title: 'name', value: 'amount' }, formats: { amount: 'currency:EUR' }, where: [{ column: 'owner', equals: 'me' }] }
        const input = formValuesToInput(viewToFormValues(view, ['name', 'stage', 'amount', 'owner']), view)
        expect(input).toEqual({ name: 'Pipeline', layout: 'board', groupBy: 'stage', fields: { title: 'name', value: 'amount' }, formats: { amount: 'currency:EUR' }, where: [{ column: 'owner', equals: 'me' }] })
    })

    it('drops the formats of columns the layout does not draw', () => {
        const values = { ...viewToFormValues(undefined, ['name', 'price']), name: 'All', columns: ['name'], formats: { price: 'number', name: NONE } }
        expect(formValuesToInput(values)).toEqual({ name: 'All', layout: 'table', columns: ['name'] })
    })

    it('previews a board from the rows on screen', () => {
        const card = previewCard(
            { name: 'x', layout: 'board', groupBy: 'stage', fields: { title: 'name' } },
            { table: 't', scope: 'agent', columns: ['name', 'stage'], rows: [{ name: 'a', stage: 'New' }, { name: 'b', stage: 'Won' }, { name: 'c', stage: 'New' }], total: 3 },
        )
        expect(card.groups).toEqual([
            { value: 'New', total: 2 },
            { value: 'Won', total: 1 },
        ])
        expect(card.rows).toHaveLength(3)
    })
})

describe('quickViewInput', () => {
    const rows = [
        { id: 1, company_name: 'Acme', logo_url: 'a.png', tier: 'gold' },
        { id: 2, company_name: 'Globex', logo_url: 'g.png', tier: 'silver' },
        { id: 3, company_name: 'Initech', logo_url: 'i.png', tier: 'gold' },
    ]
    const columns = ['id', 'company_name', 'logo_url', 'tier']

    it('names the view after its layout, skipping names already taken', () => {
        expect(quickViewInput('table', { columns, rows, takenNames: [], baseName: 'Table' })?.name).toBe('Table')
        expect(quickViewInput('table', { columns, rows, takenNames: ['table', 'Table 2'], baseName: 'Table' })?.name).toBe('Table 3')
    })

    it('titles cards by a name column and pictures a gallery by an image column', () => {
        const gallery = quickViewInput('gallery', { columns, rows, takenNames: [], baseName: 'Gallery' })
        expect(gallery?.fields).toEqual({ title: 'company_name', image: 'logo_url' })
    })

    it('groups a board by a status-like column, else by the column whose values repeat most', () => {
        expect(quickViewInput('board', { columns: [...columns, 'deal_stage'], rows, takenNames: [], baseName: 'Board' })?.groupBy).toBe('deal_stage')
        expect(quickViewInput('board', { columns, rows, takenNames: [], baseName: 'Board' })?.groupBy).toBe('tier')
    })

    it('gives up on a board when nothing repeats', () => {
        expect(quickViewInput('board', { columns: ['id', 'company_name'], rows, takenNames: [], baseName: 'Board' })).toBeNull()
    })
})
