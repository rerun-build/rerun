import { z } from 'zod'

// A `select` choice. A bare string is normalised to `{ label, value }` so authors can
// use the terse form when the visible label and stored value are identical.
export const inputOptionSchema = z.union([
    z.string().transform(s => ({ label: s, value: s })),
    z.object({ label: z.string(), value: z.string() }),
])
export type InputOption = z.infer<typeof inputOptionSchema>

// One field of an install form. `secret: true` routes the value to the engine .env
// (or an mcp header/env) and keeps it out of every UI-side store.
export const inputDefSchema = z.object({
    key: z.string(),
    label: z.string(),
    type: z.enum(['text', 'password', 'select', 'url']).default('text'),
    required: z.boolean().default(true),
    secret: z.boolean().default(false),
    options: z.array(inputOptionSchema).optional(),
    placeholder: z.string().optional(),
    // A value pasted over several lines (a service account JSON), with its file droppable instead.
    // Apart from `type` so a build of the app that predates it still reads the field, as one line.
    multiline: z.boolean().optional(),
    // One line under the field, inline markdown only: where to find the value.
    help: z.string().optional(),
    // Markdown numbered steps shown in a collapsible under the field: how to create the value,
    // with the link to the exact page in the first step.
    guide: z.string().optional(),
})
export type InputDef = z.infer<typeof inputDefSchema>
