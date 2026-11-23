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

// The shelf the composer's `/` menu offers: no body, no file list.
export const skillSummarySchema = skillSchema.pick({ slug: true, name: true, description: true })
export type SkillSummary = z.infer<typeof skillSummarySchema>
export const skillSummariesViewSchema = z.object({ skills: z.array(skillSummarySchema) })
export type SkillSummariesView = z.infer<typeof skillSummariesViewSchema>

// A skill installed by a connector is the connector's, not the agent's: rewriting it is lost at
// the next install, and deleting it leaves the connector's footprint pointing at nothing.
export function connectorSkillReadOnlyError(slug: string, service: string): string {
    return `Skill "${slug}" belongs to the ${service} app and is read-only. Reconfigure or reinstall that app to change it, or create a skill of your own instead.`
}

// A skill of the Brain: shared by every coworker of the box, who reads it and never writes it.
// `author` follows the Brain's pages (`user:<email>`, `agent:<handle>`), `addedAt` is when it entered
// the Brain, `updatedAt` its last change.
export const brainSkillSchema = skillSchema.extend({
    author: z.string().nullable(),
    addedAt: z.string(),
    updatedAt: z.string(),
})
export type BrainSkill = z.infer<typeof brainSkillSchema>
export const brainSkillsListSchema = z.object({ skills: z.array(brainSkillSchema) })

const brainSkillAuthorSchema = z.string().min(1).max(120)

export const brainSkillCreateSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().default(''),
    body: z.string().trim().min(1),
    author: brainSkillAuthorSchema,
})
export type BrainSkillCreate = z.input<typeof brainSkillCreateSchema>

export const brainSkillUpdateSchema = z.object({ description: z.string().optional(), body: z.string().trim().min(1).optional() })
export type BrainSkillUpdate = z.infer<typeof brainSkillUpdateSchema>

// Moves a coworker's own skill into the Brain: it leaves the coworker, who then reads the Brain's.
export const brainSkillShareSchema = z.object({ agentId: z.string().min(1), slug: z.string().min(1), author: brainSkillAuthorSchema })
export type BrainSkillShare = z.infer<typeof brainSkillShareSchema>

export function brainSkillReadOnlyError(slug: string): string {
    return `Skill "${slug}" is shared from the Brain with every coworker and is read-only here. Ask a person to change it in the Brain, or create a skill of your own under another name.`
}
