import { z } from 'zod'

export const TEXT_FILE_PAGE_CHARS = 100_000

export const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024

export const MAX_TEXT_WRITE_CHARS = 1_000_000

export const LEGACY_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

export const fileEntrySchema = z.object({
    name: z.string(),
    type: z.enum(['file', 'dir']),
    size: z.number(),
    modifiedAt: z.string().optional(),
})
export type FileEntry = z.infer<typeof fileEntrySchema>

export const coworkerFileKindSchema = z.enum(['media', 'doc'])
export type CoworkerFileKind = z.infer<typeof coworkerFileKindSchema>

export const coworkerFileSchema = z.object({
    path: z.string(),
    name: z.string(),
    size: z.number(),
    modifiedAt: z.string().nullable(),
    kind: coworkerFileKindSchema,
})
export type CoworkerFile = z.infer<typeof coworkerFileSchema>

export const coworkerFilesSchema = z.object({ files: z.array(coworkerFileSchema), truncated: z.boolean() })
export type CoworkerFiles = z.infer<typeof coworkerFilesSchema>

export const fileEntriesListSchema = z.object({ entries: z.array(fileEntrySchema) })

export const fileContentSchema = z.object({
    path: z.string(),
    content: z.string(),
    offset: z.number().int().nonnegative().optional(),
    nextOffset: z.number().int().nonnegative().nullable().optional(),
    totalChars: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
})
export type FileContent = z.infer<typeof fileContentSchema>

export const writeFileSchema = z.object({ path: z.string().min(1), content: z.string().max(MAX_TEXT_WRITE_CHARS) })
