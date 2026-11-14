import { z } from 'zod'

export const routineKindSchema = z.enum(['schedule', 'trigger'])
export type RoutineKind = z.infer<typeof routineKindSchema>

export const routineViewSchema = z.object({
    kind: routineKindSchema,
    slug: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    cronLabel: z.string().nullable(),
    runAt: z.string().nullable(),
    timezone: z.string().nullable(),
})
export type RoutineView = z.infer<typeof routineViewSchema>

export const routinesViewSchema = z.object({ routines: z.array(routineViewSchema) })
export type RoutinesView = z.infer<typeof routinesViewSchema>

export const updateRoutineSchema = z.object({ enabled: z.boolean() })
export type UpdateRoutineInput = z.infer<typeof updateRoutineSchema>
