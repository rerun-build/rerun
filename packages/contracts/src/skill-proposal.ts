import { z } from 'zod'

export const skillProposalModeSchema = z.enum(['create', 'edit'])
export type SkillProposalMode = z.infer<typeof skillProposalModeSchema>

export const skillProposalStatusSchema = z.enum(['proposed', 'accepted', 'applied', 'failed', 'dismissed'])
export type SkillProposalStatus = z.infer<typeof skillProposalStatusSchema>

// Nullable rather than optional: strict structured output needs every key required, and the CLI
// providers serialise an omitted field as an explicit null anyway.
export const skillProposalInputSchema = z.object({
    mode: skillProposalModeSchema,
    slug: z.string().nullable(),
    title: z.string().min(1).max(40).describe('Skill name in 2 to 5 words, covering every rule, the ones already waiting included'),
    summary: z.string().min(1).max(100).describe('One plain line on what you will do differently: the user decides from it'),
    instruction: z.string().min(10).max(800).describe('One imperative sentence, or a whole flow as short numbered steps. No context, no why'),
})
export type SkillProposalInput = z.infer<typeof skillProposalInputSchema>

export const skillProposalSchema = z.object({
    id: z.string(),
    sessionId: z.string(),
    toolCallId: z.string(),
    mode: skillProposalModeSchema,
    slug: z.string().nullable(),
    title: z.string(),
    summary: z.string(),
    instructions: z.array(z.string()).default([]),
    status: skillProposalStatusSchema,
    appliedSlug: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
})
export type SkillProposal = z.infer<typeof skillProposalSchema>

export const skillProposalsListSchema = z.object({ proposals: z.array(skillProposalSchema) })

export const skillProposalDecisionSchema = z.enum(['accept', 'dismiss'])
export type SkillProposalDecision = z.infer<typeof skillProposalDecisionSchema>

export const skillProposalDecideRequestSchema = z.object({ proposalId: z.string().min(1), decision: skillProposalDecisionSchema })
