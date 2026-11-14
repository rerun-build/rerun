import { z } from 'zod'

import { parseHubOutput } from './tool-output.js'

export const BRAIN_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const brainSlugSchema = z.string().min(1).max(64).regex(BRAIN_SLUG_RE, 'must be lowercase kebab-case, e.g. "pricing" or "acme-corp"')

export const BRAIN_CARD_TYPES = ['company', 'offering', 'market', 'team', 'voice', 'stack', 'priorities'] as const
export const BRAIN_ENTITY_TYPES = ['customer', 'competitor', 'person', 'product', 'decision', 'note'] as const
export const brainPageTypeSchema = z.enum([...BRAIN_CARD_TYPES, ...BRAIN_ENTITY_TYPES])
export type BrainPageType = z.infer<typeof brainPageTypeSchema>

export const brainAuthorSchema = z.string().min(1).max(120)

export const brainPageSummarySchema = z.object({
    slug: z.string(),
    title: z.string(),
    type: brainPageTypeSchema,
    hash: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string(),
})
export type BrainPageSummary = z.infer<typeof brainPageSummarySchema>

export const brainPageRefSchema = z.object({ slug: z.string(), title: z.string() })
export type BrainPageRef = z.infer<typeof brainPageRefSchema>

export const brainPageSchema = brainPageSummarySchema.extend({
    content: z.string(),
    sources: z.array(z.string()),
    unconfirmed: z.array(z.string()).default([]),
    links: z.array(z.string()),
    backlinks: z.array(brainPageRefSchema),
})
export type BrainPage = z.infer<typeof brainPageSchema>

export const brainRevisionSchema = z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    hash: z.string(),
    author: z.string(),
    proposalId: z.string().nullable(),
    createdAt: z.string(),
})
export type BrainRevision = z.infer<typeof brainRevisionSchema>

export const brainPagesListSchema = z.object({ pages: z.array(brainPageSummarySchema) })
export const brainPageResponseSchema = z.object({ page: brainPageSchema, revisions: z.array(brainRevisionSchema) })
export const brainRevisionContentSchema = z.object({ revision: brainRevisionSchema, content: z.string() })

export const brainPageWriteSchema = z.object({
    title: z.string().min(1).max(120),
    type: brainPageTypeSchema,
    content: z.string().max(60_000),
    sources: z.array(z.string().max(500)).max(50).default([]),
    baseHash: z.string().nullable(),
    author: brainAuthorSchema,
})
export type BrainPageWrite = z.infer<typeof brainPageWriteSchema>

export const brainProposalHighlightSchema = z.object({
    label: z.string().min(1).max(40),
    before: z.string().max(80).nullable(),
    after: z.string().min(1).max(80),
})
export type BrainProposalHighlight = z.infer<typeof brainProposalHighlightSchema>

export const brainProposalInputSchema = z.object({
    slug: brainSlugSchema,
    title: z.string().min(1).max(120),
    headline: z.string().min(1).max(60),
    highlights: z.array(brainProposalHighlightSchema).min(1).max(4),
    type: brainPageTypeSchema,
    content: z.string().min(1).max(60_000),
    reason: z.string().min(1).max(300),
    sources: z.array(z.string().max(500)).max(20),
    baseHash: z.string().nullable(),
})
export type BrainProposalInput = z.infer<typeof brainProposalInputSchema>

export const brainProposalStatusSchema = z.enum(['proposed', 'accepted', 'dismissed'])
export type BrainProposalStatus = z.infer<typeof brainProposalStatusSchema>

export const brainProposalSchema = z.object({
    id: z.string(),
    agentId: z.string(),
    agentName: z.string(),
    sessionId: z.string(),
    slug: z.string(),
    mode: z.enum(['create', 'edit']),
    title: z.string(),
    headline: z.string().nullable().default(null),
    highlights: z.array(brainProposalHighlightSchema).default([]),
    type: brainPageTypeSchema,
    content: z.string(),
    reason: z.string(),
    sources: z.array(z.string()),
    baseHash: z.string().nullable(),
    status: brainProposalStatusSchema,
    outdated: z.boolean(),
    currentContent: z.string().nullable(),
    createdAt: z.string(),
    decidedAt: z.string().nullable(),
    decidedBy: z.string().nullable(),
})
export type BrainProposal = z.infer<typeof brainProposalSchema>

export const brainProposalsListSchema = z.object({ proposals: z.array(brainProposalSchema) })
export const brainProposalCountSchema = z.object({ count: z.number().int().nonnegative() })
export const brainProposalResponseSchema = z.object({ proposal: brainProposalSchema })

export const brainRevertSchema = z.object({ author: brainAuthorSchema, expectedHash: z.string().optional() })

export const brainConfirmSectionsSchema = z.object({ headings: z.array(z.string().min(1).max(200)).max(100).nullable() })
export type BrainConfirmSections = z.infer<typeof brainConfirmSectionsSchema>

export const brainProposalAcceptSchema = z.object({
    decidedBy: brainAuthorSchema,
    content: z.string().min(1).max(60_000).optional(),
    title: z.string().min(1).max(120).optional(),
    type: brainPageTypeSchema.optional(),
})
export type BrainProposalAccept = z.infer<typeof brainProposalAcceptSchema>
export const brainProposalDismissSchema = z.object({ decidedBy: brainAuthorSchema })

export const brainSeedPageSchema = z.object({
    slug: brainSlugSchema,
    title: z.string().min(1).max(120),
    type: brainPageTypeSchema,
    content: z.string().min(1).max(60_000),
    sources: z.array(z.string().max(500)).max(50).default([]),
})
export type BrainSeedPage = z.infer<typeof brainSeedPageSchema>

export const brainSeedInputSchema = z.object({ pages: z.array(brainSeedPageSchema).max(100) })
export const brainSeedResultSchema = z.object({ written: z.array(z.string()), skipped: z.array(z.string()) })
export type BrainSeedResult = z.infer<typeof brainSeedResultSchema>

export type BrainChangeStatus = 'saved' | 'deleted' | 'accepted' | 'dismissed'

export type BrainChange = { status: BrainChangeStatus; slug: string; title: string; mode?: 'create' | 'edit'; agentName?: string; undoRevisionId?: string | null; hash?: string }

const BRAIN_CHANGE_TOOLS = new Set(['brain_write', 'brain_delete', 'brain_decide'])
const BRAIN_CHANGE_STATUSES = new Set<string>(['saved', 'deleted', 'accepted', 'dismissed'])

export function brainChangeOf(toolName: string, output: unknown): BrainChange | null {
    if (!BRAIN_CHANGE_TOOLS.has(toolName)) return null
    const change = parseHubOutput<Partial<BrainChange>>(output)
    if (!change?.status || !BRAIN_CHANGE_STATUSES.has(change.status) || !change.slug || !change.title) return null
    return change as BrainChange
}

export type BrainChangeCopy = (key: 'created' | 'saved' | 'deleted' | 'accepted' | 'acceptedBy' | 'dismissed' | 'dismissedBy', values: { title: string; name?: string }) => string

export function brainChangeHeadline({ status, title, mode, agentName }: BrainChange, t: BrainChangeCopy): string {
    switch (status) {
        case 'saved':
            return mode === 'create' ? t('created', { title }) : t('saved', { title })
        case 'deleted':
            return t('deleted', { title })
        case 'accepted':
            return agentName ? t('acceptedBy', { name: agentName, title }) : t('accepted', { title })
        case 'dismissed':
            return agentName ? t('dismissedBy', { name: agentName, title }) : t('dismissed', { title })
    }
}

export const brainRevertRequestSchema = z.object({ revisionId: z.string().min(1), expectedHash: z.string().optional() })
