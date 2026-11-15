import { z } from 'zod'

export const goalLineFormSchema = z.object({ prefix: z.string().min(1).max(40), rest: z.enum(['pull-url', 'sha', 'sentence']) }).strict()
export const runGoalSchema = z.object({ lastLineForms: z.array(goalLineFormSchema).min(1).max(4), turnLimit: z.number().int().min(1).max(10) }).strict()
export const goalStateSchema = z.enum(['running', 'met', 'not_met', 'unchecked'])
export const goalVerdictSchema = z.object({ turn: z.number().int().min(1), met: z.boolean(), reason: z.string().max(300) }).strict()
export const runGoalRecordSchema = runGoalSchema.extend({ state: goalStateSchema, verdicts: z.array(goalVerdictSchema) }).strict()

export type GoalLineForm = z.infer<typeof goalLineFormSchema>
export type RunGoal = z.infer<typeof runGoalSchema>
export type GoalState = z.infer<typeof goalStateSchema>
export type GoalVerdict = z.infer<typeof goalVerdictSchema>
export type RunGoalRecord = z.infer<typeof runGoalRecordSchema>
