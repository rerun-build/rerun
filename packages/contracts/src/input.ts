import { z } from 'zod'

export const inputOptionSchema = z.union([
    z.string().transform(s => ({ label: s, value: s })),
    z.object({ label: z.string(), value: z.string() }),
])
export type InputOption = z.infer<typeof inputOptionSchema>

export const inputDefSchema = z.object({
    key: z.string(),
    label: z.string(),
    type: z.enum(['text', 'password', 'select', 'url']).default('text'),
    required: z.boolean().default(true),
    secret: z.boolean().default(false),
    options: z.array(inputOptionSchema).optional(),
    placeholder: z.string().optional(),
    help: z.string().optional(),
    guide: z.string().optional(),
})
export type InputDef = z.infer<typeof inputDefSchema>
