import { z } from 'zod'

export const skillProposalModeSchema = z.enum(['create', 'edit'])
export type SkillProposalMode = z.infer<typeof skillProposalModeSchema>

export const skillProposalStatusSchema = z.enum(['proposed', 'accepted', 'applied', 'failed', 'dismissed'])
export type SkillProposalStatus = z.infer<typeof skillProposalStatusSchema>

export const skillProposalInputSchema = z.object({
    mode: skillProposalModeSchema,
    slug: z.string().nullable(),
    title: z.string().min(1).max(60),
    summary: z.string().min(1).max(140),
    instruction: z.string().min(10).max(4000),
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
