import {
    CARD_FIELD_ROLES,
    CARD_GALLERY_SHAPES,
    CARD_LAYOUTS,
    CARD_MAX_COLUMNS,
    CARD_TONES,
    TABLE_VIEW_NAME_MAX,
    type CardFields,
    type CardLayout,
    type CardTone,
    type TableCard,
    type TableView,
    type TableViewInput,
} from '@rerun/contracts'
import { z } from 'zod'
import { cellInputText } from '@/lib/data/views'

/** Select value standing for "no column" or "no format": Radix refuses an empty item value. */
export const NONE = '__none'

const fieldsSchema = z.object(Object.fromEntries(CARD_FIELD_ROLES.map(role => [role, z.string()])) as Record<(typeof CARD_FIELD_ROLES)[number], z.ZodString>)

// The `dialogs.viewSettings` catalog.
export type ViewFormCopy = (key: 'nameRequired' | 'titleColumnRequired' | 'groupByRequired') => string

export const viewFormSchema = (t: ViewFormCopy) =>
    z
    .object({
        name: z.string().trim().min(1, t('nameRequired')).max(TABLE_VIEW_NAME_MAX),
        layout: z.enum(CARD_LAYOUTS),
        columns: z.array(z.string()),
        fields: fieldsSchema,
        groupBy: z.string(),
        shape: z.enum(CARD_GALLERY_SHAPES),
        sortColumn: z.string(),
        sortDir: z.enum(['asc', 'desc']),
        /** Column name to format, NONE for plain text. */
        formats: z.record(z.string(), z.string()),
        /** Badge value to tone, NONE for the automatic one. */
        tones: z.record(z.string(), z.string()),
    })
    .superRefine((values, ctx) => {
        if (values.layout !== 'table' && values.fields.title === NONE) ctx.addIssue({ code: 'custom', path: ['fields', 'title'], message: t('titleColumnRequired') })
        if (values.layout === 'board' && values.groupBy === NONE) ctx.addIssue({ code: 'custom', path: ['groupBy'], message: t('groupByRequired') })
    })

export type ViewFormValues = z.infer<ReturnType<typeof viewFormSchema>>

const pick = (column: string | undefined) => column ?? NONE
const unpick = (value: string) => (value === NONE ? undefined : value)

export function viewToFormValues(view: TableView | undefined, columns: string[]): ViewFormValues {
    const fields = view?.fields ?? {}
    return {
        name: view?.name ?? '',
        layout: view?.layout ?? 'table',
        columns: view?.columns?.length ? view.columns : columns,
        fields: Object.fromEntries(CARD_FIELD_ROLES.map(role => [role, pick(fields[role] ?? (role === 'title' && !view ? columns[0] : undefined))])) as ViewFormValues['fields'],
        groupBy: pick(view?.groupBy),
        shape: view?.display?.shape ?? 'square',
        sortColumn: pick(view?.sort?.column),
        sortDir: view?.sort?.dir ?? 'asc',
        formats: view?.formats ?? {},
        tones: view?.tones ?? {},
    }
}

/** The columns a layout actually draws, which are the ones worth a format. */
export function columnsInUse(values: Pick<ViewFormValues, 'layout' | 'columns' | 'fields' | 'groupBy'>): string[] {
    if (values.layout === 'table') return values.columns
    const roles = values.layout === 'list' ? CARD_FIELD_ROLES : CARD_FIELD_ROLES.filter(role => role !== 'date')
    return [...new Set([...roles.map(role => values.fields[role]), values.groupBy].filter(column => column && column !== NONE))]
}

/** The column whose values get a color: the board columns, or the badge. */
export function toneColumn(values: Pick<ViewFormValues, 'layout' | 'fields' | 'groupBy'>): string | undefined {
    if (values.layout === 'board') return unpick(values.groupBy)
    return unpick(values.fields.badge)
}

// `where` has no editor yet: a filter the agent saved survives an edit made in the app.
export function formValuesToInput(values: ViewFormValues, base?: TableView): TableViewInput {
    const used = new Set(columnsInUse(values))
    const roles = values.layout === 'table' ? [] : CARD_FIELD_ROLES.filter(role => values.layout === 'list' || role !== 'date')
    const fields: CardFields = Object.fromEntries(roles.flatMap(role => (unpick(values.fields[role]) ? [[role, values.fields[role]]] : [])))
    const formats = Object.fromEntries(Object.entries(values.formats).filter(([column, format]) => used.has(column) && format !== NONE))
    const tones = Object.fromEntries(Object.entries(values.tones).filter(([, tone]) => tone !== NONE)) as Record<string, CardTone>
    return {
        name: values.name.trim(),
        layout: values.layout,
        ...(values.layout === 'table' ? { columns: values.columns } : { fields }),
        ...(Object.keys(formats).length ? { formats } : {}),
        ...(Object.keys(tones).length && toneColumn(values) ? { tones } : {}),
        ...(values.layout === 'board' ? { groupBy: unpick(values.groupBy) } : {}),
        ...(values.layout === 'gallery' ? { display: { shape: values.shape } } : {}),
        ...(unpick(values.sortColumn) ? { sort: { column: values.sortColumn, dir: values.sortDir } } : {}),
        ...(base?.where?.length ? { where: base.where } : {}),
    }
}

const TITLE_COLUMN = /(^|_)(name|title|label|subject)($|_)/i
const IMAGE_COLUMN = /(^|_)(image|photo|picture|avatar|thumbnail|logo|cover)($|_)/i
const GROUP_COLUMN = /(^|_)(status|stage|state|phase|step|category|type|priority)($|_)/i
const MAX_GUESSED_GROUPS = 12

function freeName(base: string, taken: string[]): string {
    const lowered = new Set(taken.map(name => name.toLowerCase()))
    if (!lowered.has(base.toLowerCase())) return base
    let n = 2
    while (lowered.has(`${base} ${n}`.toLowerCase())) n++
    return `${base} ${n}`
}

// Falls back on the column of the sampled rows with the fewest distinct values, as long as they
// still repeat: a column where every row differs is an id, not a status.
function guessGroupColumn(columns: string[], rows: Record<string, unknown>[]): string | undefined {
    const named = columns.find(column => GROUP_COLUMN.test(column))
    if (named) return named
    let best: { column: string; distinct: number } | undefined
    for (const column of columns) {
        const distinct = new Set(rows.map(row => cellInputText(row[column]))).size
        if (distinct < 2 || distinct > MAX_GUESSED_GROUPS || distinct >= rows.length) continue
        if (!best || distinct < best.distinct) best = { column, distinct }
    }
    return best?.column
}

/** A view added in one click, filled with guessed defaults; null when a board has nothing to group by. `baseName` is the layout's name in the reader's language. */
export function quickViewInput(layout: CardLayout, sample: { columns: string[]; rows: Record<string, unknown>[]; takenNames: string[]; baseName: string }): TableViewInput | null {
    const { columns, rows, takenNames, baseName } = sample
    const values = viewToFormValues(undefined, columns)
    values.name = freeName(baseName, takenNames)
    values.layout = layout
    const title = columns.find(column => TITLE_COLUMN.test(column))
    if (title) values.fields.title = title
    if (layout === 'gallery') values.fields.image = columns.find(column => IMAGE_COLUMN.test(column)) ?? NONE
    if (layout === 'board') {
        const groupBy = guessGroupColumn(columns, rows)
        if (!groupBy) return null
        values.groupBy = groupBy
    }
    return formValuesToInput(values)
}

export const isTone = (value: string): value is CardTone => (CARD_TONES as readonly string[]).includes(value)

const PREVIEW_ROWS = { table: 5, list: 5, gallery: 6, board: 3 } as const

/** A chat card drawn from the rows already on screen, so the editor shows the view before it is saved. */
export function previewCard(input: TableViewInput, sample: { table: string; scope: TableCard['scope']; columns: string[]; rows: Record<string, unknown>[]; total: number }): TableCard {
    const { layout, fields = {}, groupBy, sort } = input
    const rows = sort ? [...sample.rows].sort((a, b) => compare(a[sort.column], b[sort.column]) * (sort.dir === 'desc' ? -1 : 1)) : sample.rows
    const wanted = layout === 'table' ? (input.columns?.length ? input.columns : sample.columns) : [...new Set([...Object.values(fields), groupBy].filter((c): c is string => !!c))]
    const columns = wanted.slice(0, CARD_MAX_COLUMNS)
    let shown = rows.slice(0, PREVIEW_ROWS[layout])
    let groups: TableCard['groups']
    if (layout === 'board' && groupBy) {
        const counts = new Map<string, number>()
        for (const row of rows) counts.set(cellInputText(row[groupBy]), (counts.get(cellInputText(row[groupBy])) ?? 0) + 1)
        const order = Object.keys(input.tones ?? {})
        const rank = (value: string) => (order.indexOf(value) === -1 ? order.length : order.indexOf(value))
        groups = [...counts].sort(([a, x], [b, y]) => rank(a) - rank(b) || y - x).slice(0, 6).map(([value, total]) => ({ value, total }))
        shown = groups.flatMap(group => rows.filter(row => cellInputText(row[groupBy]) === group.value).slice(0, PREVIEW_ROWS.board))
    }
    return {
        kind: 'table',
        scope: sample.scope,
        table: sample.table,
        columns,
        rows: shown.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))),
        total: sample.total,
        columnsTruncated: wanted.length > columns.length,
        layout,
        fields,
        formats: input.formats,
        tones: input.tones,
        groupBy,
        groups,
        display: input.display,
    }
}

function compare(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === null || a === undefined) return 1
    if (b === null || b === undefined) return -1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a).localeCompare(String(b))
}
