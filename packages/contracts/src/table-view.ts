import { z } from 'zod'
import { CARD_LAYOUTS, cardDisplaySchema, cardFieldsSchema, cardTonesSchema } from './chat-card.js'

export const TABLE_VIEW_NAME_MAX = 60

const sqlValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type SqlValue = z.infer<typeof sqlValueSchema>

export const rowFilterSchema = z.object({ column: z.string(), equals: sqlValueSchema })
export type RowFilter = z.infer<typeof rowFilterSchema>

export const viewSortSchema = z.object({ column: z.string(), dir: z.enum(['asc', 'desc']) })

export const tableViewConfigSchema = z.object({
    layout: z.enum(CARD_LAYOUTS).catch('table'),
    columns: z.array(z.string()).optional().catch(undefined),
    fields: cardFieldsSchema.optional().catch(undefined),
    formats: z.record(z.string(), z.string()).optional().catch(undefined),
    tones: cardTonesSchema.optional().catch(undefined),
    groupBy: z.string().optional().catch(undefined),
    display: cardDisplaySchema.optional().catch(undefined),
    sort: viewSortSchema.optional().catch(undefined),
    where: z.array(rowFilterSchema).optional().catch(undefined),
})
export type TableViewConfig = z.infer<typeof tableViewConfigSchema>

export const tableViewSchema = tableViewConfigSchema.extend({
    id: z.string(),
    table: z.string(),
    name: z.string(),
    position: z.number(),
})
export type TableView = z.infer<typeof tableViewSchema>

export const tableViewInputSchema = tableViewConfigSchema.extend({
    name: z.string().trim().min(1).max(TABLE_VIEW_NAME_MAX),
})
export type TableViewInput = z.infer<typeof tableViewInputSchema>

export const engineTableViewsSchema = z.object({ views: z.array(tableViewSchema) })
export const engineTableViewSchema = z.object({ view: tableViewSchema })

export const engineDbGroupSchema = z.object({ value: sqlValueSchema, total: z.number(), sum: z.number().optional() })
export const engineDbGroupsSchema = z.object({ groups: z.array(engineDbGroupSchema) })
export type EngineDbGroup = z.infer<typeof engineDbGroupSchema>

export const rowUpdateSchema = z.object({ values: z.record(z.string(), sqlValueSchema) })
export type RowUpdate = z.infer<typeof rowUpdateSchema>
export const engineRowUpdateResultSchema = z.object({ row: z.record(z.string(), z.unknown()) })
