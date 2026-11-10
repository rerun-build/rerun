import { z } from 'zod'

import { parseHubOutput } from './tool-output.js'

export const BRAIN_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const brainSlugSchema = z.string().min(1).max(64).regex(BRAIN_SLUG_RE, 'must be lowercase kebab-case, e.g. "pricing" or "acme-corp"')

// The identity card is the first seven types: one page each, written by the seed. The others are
// entity pages, as many as the company needs.
export const BRAIN_CARD_TYPES = ['company', 'offering', 'market', 'team', 'voice', 'stack', 'priorities'] as const
export const BRAIN_ENTITY_TYPES = ['customer', 'competitor', 'person', 'product', 'decision', 'note'] as const
export const brainPageTypeSchema = z.enum([...BRAIN_CARD_TYPES, ...BRAIN_ENTITY_TYPES])
export type BrainPageType = z.infer<typeof brainPageTypeSchema>

// `seed`, `user:<hub user id>` or `agent:<agent name>`: who the last write came from.
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
    // Headings of the sections imported from the public web that nobody at the company confirmed.
    // Empty from an engine that does not track them yet.
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
    // Null only when creating: an edit has to name the version it was made against.
    baseHash: z.string().nullable(),
    author: brainAuthorSchema,
})
export type BrainPageWrite = z.infer<typeof brainPageWriteSchema>

// One fact the change moves, as the review card shows it: what the page says now, null when the
// fact is new, and what it says once accepted.
export const brainProposalHighlightSchema = z.object({
    label: z.string().min(1).max(40),
    before: z.string().max(80).nullable(),
    after: z.string().min(1).max(80),
})
export type BrainProposalHighlight = z.infer<typeof brainProposalHighlightSchema>

// Nullable rather than optional: strict structured output needs every key required, and the CLI
// providers serialise an omitted field as an explicit null anyway.
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
    // Missing on a proposal made before the coworkers wrote them, and on an engine not updated yet.
    headline: z.string().nullable().default(null),
    highlights: z.array(brainProposalHighlightSchema).default([]),
    type: brainPageTypeSchema,
    content: z.string(),
    reason: z.string(),
    sources: z.array(z.string()),
    baseHash: z.string().nullable(),
    status: brainProposalStatusSchema,
    // The page moved since the agent read it (or was created meanwhile): the diff is against a
    // version the agent never saw.
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

// expectedHash: the version the caller saw; the revert conflicts if the page moved since. Absent
// from the history panel, where the person sees the current page before restoring.
export const brainRevertSchema = z.object({ author: brainAuthorSchema, expectedHash: z.string().optional() })

// Null confirms every section of the page.
export const brainConfirmSectionsSchema = z.object({ headings: z.array(z.string().min(1).max(200)).max(100).nullable() })
export type BrainConfirmSections = z.infer<typeof brainConfirmSectionsSchema>

export const brainProposalAcceptSchema = z.object({
    decidedBy: brainAuthorSchema,
    // What the person retouched before accepting; the agent's version when absent.
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

// undoRevisionId: the revision the page had before a write, to put it back from the chat; hash: the
// version the write produced, so the undo refuses once the page moved on.
export type BrainChange = { status: BrainChangeStatus; slug: string; title: string; mode?: 'create' | 'edit'; agentName?: string; undoRevisionId?: string | null; hash?: string }

const BRAIN_CHANGE_TOOLS = new Set(['brain_write', 'brain_delete', 'brain_decide'])
const BRAIN_CHANGE_STATUSES = new Set<string>(['saved', 'deleted', 'accepted', 'dismissed'])

// The foreman's brain tools answer a change that landed as JSON, and anything else (a conflict, a
// page that is not there) as a sentence for the model, which stays an ordinary tool step.
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
