import { DEFAULT_LOCALE } from '@rerun/i18n'
import { formatDate, formatNumber } from '@rerun/i18n/format'

import { humanizeTableName } from '@/lib/data/table-name'
import type { EngineDbColumn } from '@/lib/engine/types'

export type ColumnKind = 'title' | 'code' | 'text' | 'longtext' | 'number' | 'currency' | 'cents' | 'percent' | 'rating' | 'date' | 'status' | 'tags' | 'email' | 'url' | 'boolean' | 'person' | 'json'

export type FriendlyColumn = {
    key: string
    label: string
    kind: ColumnKind
    /** Left out of the grid. */
    hidden?: boolean
}

type FriendlyRow = Record<string, unknown>

const NUMERIC_KINDS: ColumnKind[] = ['number', 'currency', 'cents', 'percent', 'rating']

export function isNumericKind(kind: ColumnKind) {
    return NUMERIC_KINDS.includes(kind)
}

export function isEmpty(value: unknown) {
    return value === null || value === undefined || value === ''
}

export function capitalize(value: string) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

export function columnLabel(name: string): string {
    const stripped = name
        .replace(/_(at|on)$/i, '')
        .replace(/_cents$/i, '')
        .replace(/^is_/i, '')
        .replace(/^has_/i, 'has ')
    return humanizeTableName(stripped)
        .replace(/\bUrl\b/i, 'URL')
        .replace(/\bId\b/i, 'ID')
}

export function parseJson(value: unknown): unknown {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return value
    try {
        return JSON.parse(trimmed)
    } catch {
        return value
    }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const CURRENCY_CODE = /^[a-z]{3}$/i

function inferKind(column: EngineDbColumn, values: unknown[]): ColumnKind {
    const lower = column.name.toLowerCase()
    const declared = column.type.toUpperCase()
    const present = values.filter(value => !isEmpty(value))
    const parsed = present.map(parseJson)
    const strings = present.filter((value): value is string => typeof value === 'string')

    if (parsed.length > 0 && parsed.every(value => Array.isArray(value) && value.every(item => typeof item === 'string'))) return 'tags'
    if (parsed.some(value => typeof value === 'object' && value !== null)) return 'json'
    if (/BOOL/.test(declared) || /(^is_|^has_|_flag$)/.test(lower)) return 'boolean'
    if (/(_at|_on|date)$/.test(lower) || (strings.length > 0 && strings.every(value => ISO_DATE.test(value)))) return 'date'
    if (lower.includes('email') || (strings.length > 0 && strings.every(value => EMAIL.test(value)))) return 'email'
    if (/(url|website|link)$/.test(lower) || (strings.length > 0 && strings.every(value => /^https?:\/\//.test(value)))) return 'url'
    if (/(owner|assignee|author|coworker|agent)$/.test(lower)) return 'person'
    if (lower.endsWith('_cents')) return 'cents'
    if (/(^|_)(price|amount|revenue|mrr|arr|cost|pricing)(_|$)|_value$/.test(lower)) return 'currency'
    if (lower === 'rating' || lower.endsWith('_rating')) return 'rating'
    if (/(rate|ratio|percent|pct|lift)$/.test(lower)) return 'percent'
    // Identifiers and the like are numbers nobody sums: no thousands separators for them.
    if (/(^|_)id$/.test(lower)) return 'code'
    if (/(^|_)(year|zip|zipcode|postal_code|phone|phone_number)$/.test(lower)) return 'text'
    const allNumbers = present.length > 0 && present.every(value => typeof value === 'number')
    if (allNumbers || (present.length === 0 && /INT|REAL|FLOA|DOUB|NUM|DEC/.test(declared))) return 'number'
    if (strings.length > 0 && strings.every(value => /^[\w-]{12,}$/.test(value) && /\d/.test(value))) return 'code'
    if (/(name|title|label|subject)$/.test(lower)) return 'text'
    const distinct = new Set(strings)
    const averageLength = strings.reduce((sum, value) => sum + value.length, 0) / Math.max(1, strings.length)
    const repeats = strings.length >= 4 && distinct.size <= Math.min(5, strings.length / 2)
    if (/(status|stage|state|level|priority|type|category)$/.test(lower) || (repeats && averageLength < 14)) return 'status'
    if (averageLength > 48) return 'longtext'
    return 'text'
}

// An INTEGER primary key is the rowid under another name: a counter, never something a person reads.
export function isRowidAlias(column: EngineDbColumn) {
    return column.pk && /INT/i.test(column.type) && /^(id|rowid)$/i.test(column.name)
}

/** Every column with a kind and a label in words. The one that names a row becomes its title. */
export function friendlyColumns(columns: EngineDbColumn[], rows: FriendlyRow[]): FriendlyColumn[] {
    const inferred: FriendlyColumn[] = columns.map(column => ({
        key: column.name,
        label: columnLabel(column.name),
        kind: inferKind(column, rows.map(row => row[column.name])),
        hidden: isRowidAlias(column) || undefined,
    }))
    const readable = inferred.filter(column => !column.hidden)
    const named = readable.find(column => column.kind === 'text' && /(name|title|label|company|subject)$/i.test(column.key))
    const title = named ?? readable.find(column => column.kind === 'text') ?? readable.find(column => column.kind === 'email')
    if (title) title.kind = 'title'
    if (inferred.some(column => column.kind === 'cents' || column.kind === 'currency')) {
        const currency = inferred.find(column => column.key.toLowerCase() === 'currency')
        const codes = currency ? rows.map(row => row[currency.key]).filter(value => !isEmpty(value)) : []
        // Once the amounts carry their symbol, a column that only repeats "usd" says nothing more.
        if (currency && codes.length > 0 && codes.every(value => typeof value === 'string' && CURRENCY_CODE.test(value))) currency.hidden = true
    }
    return inferred
}

/** The grid order: the title leads, unless a view set the order itself. */
export function gridColumns(columns: FriendlyColumn[], order?: string[]): FriendlyColumn[] {
    const shown = columns.filter(column => !column.hidden)
    if (order?.length) return order.flatMap(key => columns.find(column => column.key === key) ?? [])
    const title = shown.find(column => column.kind === 'title')
    return title ? [title, ...shown.filter(column => column !== title)] : shown
}

function parseDate(text: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00`)
    // SQLite's datetime('now') writes UTC with a space and no zone.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) return Date.parse(`${text.replace(' ', 'T')}Z`)
    return Date.parse(text)
}

const DAY = 24 * 60 * 60 * 1000

export function relativeDate(value: string, locale: string = DEFAULT_LOCALE, now = Date.now()): string {
    const time = parseDate(value)
    if (Number.isNaN(time)) return value
    const diff = now - time
    if (diff < 0) return absoluteDate(value, locale)
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
    const minutes = Math.round(diff / 60_000)
    if (minutes < 60) return minutes <= 1 ? relative.format(0, 'second') : relative.format(-minutes, 'minute')
    const hours = Math.round(minutes / 60)
    if (hours < 24) return relative.format(-hours, 'hour')
    const days = Math.round(diff / DAY)
    if (days < 7) return relative.format(-days, 'day')
    const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear()
    return formatDate(time, locale, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

export function absoluteDate(value: string, locale: string = DEFAULT_LOCALE): string {
    const time = parseDate(value)
    if (Number.isNaN(time)) return value
    const hasTime = /\d{2}:\d{2}/.test(value)
    return formatDate(time, locale, { dateStyle: 'medium', timeStyle: hasTime ? 'short' : undefined })
}

export function domainOf(url: string) {
    return url
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
}

const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i

/** Where a link to an outside page points. An agent often writes `instagram.com/x` without a scheme, which a browser reads as a path inside the app. */
export function externalHref(value: string): string | undefined {
    const trimmed = value.trim()
    if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed
    if (/^\/\/[^/\s]/.test(trimmed)) return `https:${trimmed}`
    if (BARE_DOMAIN.test(trimmed)) return `https://${trimmed}`
    return undefined
}

/** The currency a row states for its amounts, when it has a `currency` column holding an ISO code. */
export function rowCurrency(row: FriendlyRow): string | undefined {
    const value = row.currency ?? row.Currency
    return typeof value === 'string' && CURRENCY_CODE.test(value) ? value.toUpperCase() : undefined
}

const plainNumber = (value: number, locale: string) => formatNumber(value, locale, { maximumFractionDigits: 2 })

function money(amount: number, currency: string | undefined, fractionDigits: number, locale: string) {
    if (!currency) return formatNumber(amount, locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
    try {
        return formatNumber(amount, locale, { style: 'currency', currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
    } catch {
        return `${plainNumber(amount, locale)} ${currency}`
    }
}

/** A value as a person would write it. Money only gets a symbol when the row says which currency it is in. */
export function plainValue(value: unknown, kind: ColumnKind, currency?: string, locale: string = DEFAULT_LOCALE): string {
    if (isEmpty(value)) return ''
    const number = Number(value)
    switch (kind) {
        case 'date':
            return relativeDate(String(value), locale)
        case 'currency':
            return Number.isNaN(number) ? String(value) : money(number, currency, Number.isInteger(number) ? 0 : 2, locale)
        case 'cents':
            return Number.isNaN(number) ? String(value) : money(number / 100, currency, 2, locale)
        case 'percent':
            return Number.isNaN(number) ? String(value) : `${Math.round((Math.abs(number) <= 1 ? number * 100 : number) * 10) / 10}%`
        case 'number':
            return Number.isNaN(number) ? String(value) : plainNumber(number, locale)
        case 'url':
            return domainOf(String(value))
        case 'boolean':
            return truthy(value) ? 'Yes' : 'No'
        case 'status':
            return capitalize(String(value))
        case 'tags': {
            const parsed = parseJson(value)
            return Array.isArray(parsed) ? parsed.join(', ') : String(value)
        }
        case 'json': {
            const parsed = parseJson(value)
            if (Array.isArray(parsed)) return `${parsed.length} ${parsed.length === 1 ? 'item' : 'items'}`
            if (typeof parsed === 'object' && parsed !== null) {
                const count = Object.keys(parsed).length
                return `${count} ${count === 1 ? 'detail' : 'details'}`
            }
            return String(value)
        }
        default:
            return typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
}

export function truthy(value: unknown) {
    if (isEmpty(value)) return false
    if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.trim().toLowerCase())
    return Boolean(Number(value))
}
