import type { CardLayout, EngineDbGroup, TableView } from '@rerun/contracts'
import type { EngineDbColumn } from '@/lib/engine/types'
import { ImagesIcon, KanbanIcon, ListIcon, TableIcon, type LucideIcon } from '@/lib/icons'
import type { SqlValue } from '@/lib/data/source'

export const LAYOUT_ICONS: Record<CardLayout, LucideIcon> = {
    table: TableIcon,
    list: ListIcon,
    gallery: ImagesIcon,
    board: KanbanIcon,
}

/** The id under which the plain grid of every column is remembered, next to the saved views. */
export const ALL_ROWS = '__all'

export function findView(views: TableView[], idOrName: string | undefined): TableView | undefined {
    if (!idOrName) return undefined
    return views.find(view => view.id === idOrName) ?? views.find(view => view.name.toLowerCase() === idOrName.toLowerCase())
}

const lastViewKey = (storageKey: string, table: string) => `rerun:data-view:${storageKey}:${table}`

export function readLastView(storageKey: string, table: string): string | null {
    try {
        return window.localStorage.getItem(lastViewKey(storageKey, table))
    } catch {
        return null
    }
}

export function writeLastView(storageKey: string, table: string, viewId: string): void {
    try {
        window.localStorage.setItem(lastViewKey(storageKey, table), viewId)
    } catch {}
}

/** The text an editor starts from for a stored value. */
export function cellInputText(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
}

// SQLite keeps whatever it is handed, so a number typed into an INTEGER column has to leave as a
// number, or sorting and summing it later goes wrong. An empty field is NULL where the column allows it.
export function coerceCellInput(text: string, column: EngineDbColumn | undefined): SqlValue {
    if (text === '') return column?.notnull ? '' : null
    const type = column?.type.toUpperCase() ?? ''
    const trimmed = text.trim()
    if (/INT/.test(type) && /^-?\d+$/.test(trimmed)) return Number(trimmed)
    if (/REAL|FLOA|DOUB|NUM|DEC/.test(type) && trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed)
    if (/BOOL/.test(type)) {
        const lowered = trimmed.toLowerCase()
        if (['true', 'yes', '1'].includes(lowered)) return 1
        if (['false', 'no', '0'].includes(lowered)) return 0
    }
    return text
}

export type BoardColumn = { key: string; value: SqlValue; label: string; total: number; sum?: number }

export const groupKey = (value: SqlValue) => JSON.stringify(value)

// Columns named in `tones` come first and in that order, the way a card orders them, and keep their
// place even when empty so a row can still be dragged into them.
export function boardColumns(groups: EngineDbGroup[], tones: Record<string, string> | undefined): BoardColumn[] {
    const columns: BoardColumn[] = groups.map(group => ({ key: groupKey(group.value), value: group.value, label: group.value === null ? '' : String(group.value), total: group.total, sum: group.sum }))
    const order = Object.keys(tones ?? {})
    for (const label of order) if (!columns.some(column => column.label === label)) columns.push({ key: groupKey(label), value: label, label, total: 0 })
    const rank = (column: BoardColumn) => {
        const index = order.indexOf(column.label)
        return index === -1 ? order.length : index
    }
    return columns.sort((a, b) => rank(a) - rank(b) || b.total - a.total)
}

export function isSummable(format: string | undefined): boolean {
    return format === 'number' || !!format?.startsWith('currency:')
}
