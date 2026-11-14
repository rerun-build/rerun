import { z } from 'zod'

export const MAX_SKILL_REFERENCE_FILES = 200
export const MAX_SKILL_FILE_BYTES = 10 * 1024 * 1024
export const MAX_SKILL_FOLDER_BYTES = 50 * 1024 * 1024

export const skillSchema = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().default(''),
    body: z.string().default(''),
    files: z.array(z.string()).default([]),
})
export type Skill = z.infer<typeof skillSchema>

export const skillFilePayloadSchema = z.object({
    path: z.string().min(1),
    content: z.string(),
})
export type SkillFilePayload = z.infer<typeof skillFilePayloadSchema>

export const skillsListSchema = z.object({ skills: z.array(skillSchema) })

export const skillSummarySchema = skillSchema.pick({ slug: true, name: true, description: true })
export type SkillSummary = z.infer<typeof skillSummarySchema>
export const skillSummariesViewSchema = z.object({ skills: z.array(skillSummarySchema) })
export type SkillSummariesView = z.infer<typeof skillSummariesViewSchema>

export function connectorSkillReadOnlyError(slug: string, service: string): string {
    return `Skill "${slug}" belongs to the ${service} app and is read-only. Reconfigure or reinstall that app to change it, or create a skill of your own instead.`
}
