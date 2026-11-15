import { z } from 'zod'

export const CARD_DEFAULT_ROWS = 5
export const CARD_MAX_ROWS = 20
export const CARD_MAX_COLUMNS = 8
export const CARD_MAX_CELL_CHARS = 120
export const CARD_MAX_MEDIA_CHARS = 2048
export const CARD_MAX_GROUPS = 6

export const CARD_LAYOUTS = ['table', 'list', 'gallery', 'board'] as const
export type CardLayout = (typeof CARD_LAYOUTS)[number]

export const CARD_TONES = ['brand', 'neutral', 'green', 'red', 'orange', 'cyan', 'yellow'] as const
export type CardTone = (typeof CARD_TONES)[number]

export const CARD_FORMATS = ['number', 'percent', 'date', 'datetime', 'rating', 'progress', 'boolean', 'url', 'email', 'tag', 'image'] as const
export type CardFormat = (typeof CARD_FORMATS)[number] | `currency:${string}`

const CURRENCY_FORMAT = /^currency:[A-Z]{3}$/

export function isCardFormat(value: string): value is CardFormat {
    return (CARD_FORMATS as readonly string[]).includes(value) || CURRENCY_FORMAT.test(value)
}

export const CARD_GALLERY_SHAPES = ['square', 'landscape', 'portrait'] as const
export const CARD_GALLERY_ARRANGEMENTS = ['grid', 'carousel'] as const

export const cardFieldsSchema = z.object({
    title: z.string().optional(),
    subtitle: z.string().optional(),
    image: z.string().optional(),
    badge: z.string().optional(),
    value: z.string().optional(),
    date: z.string().optional(),
})
export type CardFields = z.infer<typeof cardFieldsSchema>
export const CARD_FIELD_ROLES = ['title', 'subtitle', 'image', 'badge', 'value', 'date'] as const satisfies readonly (keyof CardFields)[]

export const cardTonesSchema = z.record(z.string(), z.enum(CARD_TONES).catch('neutral'))

export const cardDisplaySchema = z.object({
    shape: z.enum(CARD_GALLERY_SHAPES).optional(),
    arrangement: z.enum(CARD_GALLERY_ARRANGEMENTS).optional(),
})

export const tableCardSchema = z.object({
    kind: z.literal('table'),
    scope: z.enum(['agent', 'shared']),
    table: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.record(z.string(), z.unknown())),
    total: z.number(),
    columnsTruncated: z.boolean(),
    layout: z.enum(CARD_LAYOUTS).optional().catch(undefined),
    fields: cardFieldsSchema.optional(),
    formats: z.record(z.string(), z.string()).optional(),
    tones: cardTonesSchema.optional(),
    groupBy: z.string().optional(),
    groups: z.array(z.object({ value: z.string(), total: z.number(), sum: z.number().optional() })).optional(),
    display: cardDisplaySchema.optional().catch(undefined),
    view: z.string().optional(),
})
export type TableCard = z.infer<typeof tableCardSchema>
export type TableCardGroup = NonNullable<TableCard['groups']>[number]

export const CARD_MAX_FILES = 12

export const fileCardEntrySchema = z.object({
    path: z.string(),
    name: z.string(),
    size: z.number(),
    scope: z.enum(['agent', 'shared']).default('agent'),
})
export type FileCardEntry = z.infer<typeof fileCardEntrySchema>

const withLegacySingleFile = (value: unknown) =>
    value && typeof value === 'object' && !('files' in value) && 'path' in value ? { kind: 'file', files: [value] } : value

export const fileCardSchema = z.preprocess(
    withLegacySingleFile,
    z.object({
        kind: z.literal('file'),
        files: z.array(fileCardEntrySchema).min(1),
    })
)
export type FileCard = z.infer<typeof fileCardSchema>

export function cellText(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
}

export function formatText(value: unknown, format?: string): string {
    if (value === null || value === undefined || value === '') return ''
    if (format?.startsWith('currency:')) {
        const number = Number(value)
        if (Number.isNaN(number)) return cellText(value)
        try {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: format.slice('currency:'.length), maximumFractionDigits: 0 }).format(number)
        } catch {
            return cellText(value)
        }
    }
    if (format === 'number') {
        const number = Number(value)
        if (Number.isNaN(number)) return cellText(value)
        return new Intl.NumberFormat('en-US', { notation: Math.abs(number) >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(number)
    }
    if (format === 'percent') {
        const number = Number(value)
        return Number.isNaN(number) ? cellText(value) : `${Math.round(number * 100)}%`
    }
    if (format === 'date' || format === 'datetime') {
        const date = parseUtc(String(value))
        if (Number.isNaN(date.getTime())) return cellText(value)
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
            ...(format === 'datetime' ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
        }).format(date)
    }
    if (format === 'url')
        return String(value)
            .replace(/^https?:\/\/(www\.)?/, '')
            .replace(/\/$/, '')
    return cellText(value)
}

function parseUtc(text: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text)) return new Date(`${text.replace(' ', 'T')}Z`)
    return new Date(text)
}

export function isNumericFormat(format?: string) {
    return format === 'number' || format === 'percent' || !!format?.startsWith('currency:')
}

export function isTruthyCell(value: unknown) {
    if (typeof value === 'string') return !['', '0', 'false', 'no'].includes(value.trim().toLowerCase())
    return !!value
}
