import { isAbsolute, relative, sep } from 'node:path'
import type { Client } from '@libsql/client'
import { z } from 'zod'
import {
    CARD_DEFAULT_ROWS,
    CARD_FORMATS,
    CARD_GALLERY_ARRANGEMENTS,
    CARD_GALLERY_SHAPES,
    CARD_LAYOUTS,
    CARD_MAX_CELL_CHARS,
    CARD_MAX_COLUMNS,
    CARD_MAX_GROUPS,
    CARD_MAX_MEDIA_CHARS,
    CARD_MAX_ROWS,
    CARD_TONES,
    type CardLayout,
    type TableCard,
    type TableCardGroup,
    type TableViewConfig,
} from '@moldwright/contracts'
import { groupTableRows, readTableRows, tableColumns, type RowFilter, type RowGroup } from '../../db/sqlStore.js'
import { checkViewColumns } from '../../db/tableViews.js'

const DEFAULT_LIMIT: Record<CardLayout, number> = { table: CARD_DEFAULT_ROWS, list: CARD_DEFAULT_ROWS, gallery: 6, board: 3 }
const GROUPS_READ = 200

const scopeInput = z.enum(['agent', 'shared']).describe("'agent' for your own private database, 'shared' for the database every coworker of this space shares")

export const tableDisplayInput = {
    layout: z
        .enum(CARD_LAYOUTS)
        .optional()
        .describe("'table' (default) to compare values across columns; 'list' for rows read by a name (people, companies); 'gallery' for rows recognised by a picture (needs fields.image); 'board' for rows moving through statuses (needs groupBy)."),
    columns: z.array(z.string()).optional().describe(`table layout only: the columns to show, in this order. Defaults to the first ${CARD_MAX_COLUMNS}.`),
    sort: z
        .object({ column: z.string(), dir: z.enum(['asc', 'desc']).default('asc') })
        .optional()
        .describe('Which rows come first, e.g. { column: "score", dir: "desc" }. Default: insertion order.'),
    where: z
        .array(z.object({ column: z.string(), equals: z.union([z.string(), z.number(), z.boolean(), z.null()]) }))
        .optional()
        .describe('Only the rows matching every one of these equalities.'),
    fields: z
        .object({
            title: z.string().optional().describe('Column each item is named by; required for every layout but table'),
            subtitle: z.string().optional().describe('Column shown under the title'),
            image: z.string().optional().describe('Column holding an image URL or a workspace path'),
            badge: z.string().optional().describe('Column shown as a colored badge, e.g. a status'),
            value: z.string().optional().describe('Column shown as the headline number'),
            date: z.string().optional().describe('Column holding a date'),
        })
        .optional()
        .describe('Which column plays which role in a list, gallery or board.'),
    formats: z
        .record(z.string(), z.string())
        .optional()
        .describe(`Column name to display format: ${CARD_FORMATS.join(', ')}, or currency:XXX with an ISO code. progress takes 0-1 or 0-100, rating 0-5.`),
    tones: z
        .record(z.string(), z.enum(CARD_TONES))
        .optional()
        .describe("Badge value to color, e.g. { Won: 'green', Lost: 'red' }; unlisted values get a stable color. On a board, the key order is the column order."),
    groupBy: z.string().optional().describe('board only: the column whose values become its columns, e.g. a stage'),
    display: z
        .object({ shape: z.enum(CARD_GALLERY_SHAPES).optional(), arrangement: z.enum(CARD_GALLERY_ARRANGEMENTS).optional() })
        .optional()
        .describe("gallery only: the picture shape ('square' by default), and 'carousel' for one sideways row instead of a 'grid'"),
}

export const tableTargetInput = {
    scope: scopeInput,
    table: z.string().describe('Name of the table'),
}

export const tableCardInput = z.object({
    ...tableTargetInput,
    view: z.string().describe('Name of a view saved on this table with table_view_save. The card is drawn exactly like it, and its button opens the table on that tab.'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(CARD_MAX_ROWS)
        .optional()
        .describe('How many rows the card shows: 5 by default, 6 for a gallery. On a board, how many cards under each column, 3 by default.'),
})

export type TableCardSpec = TableViewConfig & { scope: 'agent' | 'shared'; table: string; view?: string; limit?: number }

type BuildContext = { hidden: string[]; workspace: string }

export async function buildTableCard(client: Client, input: TableCardSpec, { hidden, workspace }: BuildContext): Promise<TableCard> {
    const { scope, table, layout, fields = {}, formats = {}, tones, groupBy, where = [], sort, display, view } = input
    const allColumns = (await tableColumns(client, table, hidden)).map(c => c.name)
    checkViewColumns(table, allColumns, { layout, fields, formats, columns: input.columns, where, sort, groupBy })

    const wanted = layout === 'table' ? (input.columns?.length ? input.columns : allColumns) : unique([...Object.values(fields), groupBy])
    const columns = wanted.slice(0, CARD_MAX_COLUMNS)
    const media = new Set([fields.image, ...Object.entries(formats).filter(([, f]) => f === 'image' || f === 'url').map(([c]) => c)])
    const images = new Set([fields.image, ...Object.entries(formats).filter(([, f]) => f === 'image').map(([c]) => c)])
    const limit = input.limit ?? DEFAULT_LIMIT[layout]
    const read = { offset: 0, sort: sort?.column, dir: sort?.dir, columns, hidden }

    let rows: Record<string, unknown>[]
    let total: number
    let groups: TableCardGroup[] | undefined
    if (layout === 'board' && groupBy) {
        const valueFormat = fields.value ? formats[fields.value] : undefined
        const sumColumn = valueFormat === 'number' || valueFormat?.startsWith('currency:') ? fields.value : undefined
        const all = await groupTableRows(client, table, { groupBy, sumColumn, where, limit: GROUPS_READ, hidden })
        const picked = orderGroups(all, tones).slice(0, CARD_MAX_GROUPS)
        const perGroup = Math.max(1, Math.min(limit, Math.floor(CARD_MAX_ROWS / Math.max(1, picked.length))))
        const reads = await Promise.all(picked.map(group => readTableRows(client, table, { ...read, limit: perGroup, where: [...where, { column: groupBy, equals: group.value }] })))
        rows = reads.flatMap(result => result.rows)
        total = (await readTableRows(client, table, { ...read, limit: 0, where })).total
        groups = picked.map(group => ({ value: groupLabel(group.value), total: group.total, ...(group.sum !== undefined ? { sum: group.sum } : {}) }))
    } else {
        const result = await readTableRows(client, table, { ...read, limit, where })
        rows = result.rows
        total = result.total
    }

    const shownFormats = Object.fromEntries(Object.entries(formats).filter(([column]) => columns.includes(column)))
    return {
        kind: 'table',
        scope,
        table,
        columns,
        rows: rows.map(row => Object.fromEntries(columns.map(column => [column, cell(row[column], media.has(column), images.has(column) ? workspace : undefined)]))),
        total,
        columnsTruncated: wanted.length > columns.length,
        ...(layout !== 'table' ? { layout, fields } : {}),
        ...(Object.keys(shownFormats).length > 0 ? { formats: shownFormats } : {}),
        ...(tones ? { tones } : {}),
        ...(groups ? { groupBy, groups } : {}),
        ...(layout === 'gallery' && display ? { display } : {}),
        ...(view ? { view } : {}),
    }
}

function cell(value: unknown, media: boolean, workspace: string | undefined): unknown {
    if (typeof value !== 'string') return value
    if (!media) return value.length <= CARD_MAX_CELL_CHARS ? value : `${value.slice(0, CARD_MAX_CELL_CHARS)}…`
    if (value.length > CARD_MAX_MEDIA_CHARS) return null
    if (workspace && isAbsolute(value) && value.startsWith(workspace + sep)) return relative(workspace, value)
    return value
}

function orderGroups(groups: RowGroup[], tones: Record<string, string> | undefined): RowGroup[] {
    if (!tones) return groups
    const order = Object.keys(tones)
    const rank = (group: RowGroup) => {
        const index = order.indexOf(groupLabel(group.value))
        return index === -1 ? order.length : index
    }
    return [...groups].sort((a, b) => rank(a) - rank(b) || b.total - a.total)
}

function groupLabel(value: RowFilter['equals']): string {
    return value === null ? '' : String(value)
}

function unique(values: (string | undefined)[]): string[] {
    return [...new Set(values.filter((value): value is string => !!value))]
}
