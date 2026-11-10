import { isPublicStatus, templateDocumentObject, type TemplateDocument, type TemplatePricing, type TemplatePricingModel, type TemplateStatus } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { agentsFromRow } from './document'

// What an expert may author, and nothing else. The admin editor owns the slug, the visibility
// flags and the social card; this is the whole editorial page, plus the agents they capture
// themselves.

// The list only needs enough to draw a row: the editor loads the full document separately.
export const EXPERT_TEMPLATE_COLUMNS = [
    'id',
    'slug',
    'title',
    'tagline',
    'category',
    'status',
    'gallery',
    'agent_count',
    'pricing_model',
    'price_amount_cents',
    'price_currency',
    'submitted_at',
    'review_note',
    'updated_at',
] as const

export type ExpertTemplateRow = {
    id: string
    slug: string
    title: string
    tagline: string
    category: string
    status: string
    gallery: unknown
    agent_count: number | null
    pricing_model: string
    price_amount_cents: number
    price_currency: string
    submitted_at: string | null
    review_note: string | null
    updated_at: string
}

// The panel lists agents to remove them, and nothing else: the editorial detail behind each one
// (skills, schedules, tools) belongs to the admin editor, and the archives never cross the wire.
export type ExpertTemplateAgent = { key: string; name: string; role: string; connectorSlugs: string[]; setupRequired: boolean | null }

// The row a template gets in the list.
export type ExpertTemplate = {
    id: string
    slug: string
    title: string
    tagline: string
    category: string
    status: string
    coverUrl: string | null
    agentCount: number
    pricing: TemplatePricing
    submittedAt: string | null
    reviewNote: string | null
    updatedAt: string
}

// Everything the editor needs on top of the document itself.
export type ExpertTemplateDetail = {
    id: string
    status: string
    submittedAt: string | null
    reviewNote: string | null
    document: TemplateDocument
    agents: ExpertTemplateAgent[]
}

export function toExpertTemplates(rows: ExpertTemplateRow[]): ExpertTemplate[] {
    return rows.map(row => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        tagline: row.tagline,
        category: row.category,
        status: row.status,
        coverUrl: coverFromRow(row.gallery),
        agentCount: row.agent_count ?? 0,
        pricing: { model: row.pricing_model as TemplatePricingModel, amountCents: row.price_amount_cents, currency: row.price_currency },
        submittedAt: row.submitted_at,
        reviewNote: row.review_note,
        updatedAt: row.updated_at,
    }))
}

const galleryFromRow = z.array(z.object({ url: z.string() }).passthrough()).catch([])

function coverFromRow(gallery: unknown): string | null {
    return galleryFromRow.parse(gallery)[0]?.url ?? null
}

export function toExpertTemplateAgents(agents: unknown): ExpertTemplateAgent[] {
    return agentsFromRow.parse(agents).map(agent => ({ key: agent.key, name: agent.name, role: agent.role, connectorSlugs: agent.connectorSlugs, setupRequired: agent.setupRequired }))
}

// An author edits their drafts. A submission is frozen until we answer it, and a public template is
// a page we maintain, so both turn read-only on their side and the admin editor takes over.
export function templateEditBlockCode(status: string): 'templateInReview' | 'templatePublished' | null {
    if (status === 'in_review') return 'templateInReview'
    return isPublicStatus(status as TemplateStatus) ? 'templatePublished' : null
}

export function templateEditBlockReason(status: string): string | null {
    if (status === 'in_review') return 'This template is waiting for our review. Withdraw it to keep editing.'
    return isPublicStatus(status as TemplateStatus) ? 'This template has been published and can no longer be edited.' : null
}

// The author writes the whole editorial page, us the URL, the visibility and the social card. Picked
// off the document object so every limit and default stays defined in one place.
export const templateAuthorSchema = templateDocumentObject.pick({
    title: true,
    tagline: true,
    category: true,
    tags: true,
    setupMinutes: true,
    longDescription: true,
    gallery: true,
    videoUrl: true,
    faq: true,
    metaTitle: true,
    metaDescription: true,
    // The author prices their own work. They only ever reach a draft: once a template is public
    // `templateEditBlockReason` locks the whole document, so a live price is an admin edit.
    pricingModel: true,
    priceAmountCents: true,
})
export type TemplateAuthorInput = z.infer<typeof templateAuthorSchema>

// The panel posts the whole form; an MCP caller sends the one field it means to change. Beware:
// `.partial()` does NOT cancel the `.default()` every picked field carries, so parsing `{ title }`
// still hands back an empty tagline, an empty gallery and a price of 0. Filtering the result down
// to the keys the caller actually sent is what makes a patch a patch — see `pickSentFields`.
export const templateAuthorPatchSchema = templateAuthorSchema.partial()
export type TemplateAuthorPatch = z.infer<typeof templateAuthorPatchSchema>

export function pickSentFields(parsed: TemplateAuthorPatch, sent: Record<string, unknown>): TemplateAuthorPatch {
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => key in sent)) as TemplateAuthorPatch
}

// The server boundary. `stored` is the document just read from the row and it is spread FIRST, so a
// forged payload cannot reach `status`, `slug`, `featured`, `showInMarketplace`, `agents`,
// `ogImageUrl` or `creatorId`: the zod object strips them at parse time, and this spread would
// overwrite them anyway.
export function mergeAuthorDocument(stored: TemplateDocument, patch: TemplateAuthorPatch): TemplateDocument {
    return { ...stored, ...patch }
}

export type ExpertProfile = { id: string; slug: string; name: string; avatarUrl: string | null; status: string }

// The whole mapping: a template belongs to a user, and the credited expert is the optional fiche
// that user points at. Nothing is written here, and no fiche is auto-provisioned.
export async function resolveExpertForUser(supabase: SupabaseClient<Database>, userId: string): Promise<ExpertProfile | null> {
    const { data: account } = await selectMaybeSingle(supabase, 'users', ['expert_profile_id'] as const, { id: userId })
    if (!account?.expert_profile_id) return null

    const { data } = await selectMaybeSingle(supabase, 'experts', ['id', 'slug', 'name', 'avatar_url', 'status'] as const, { id: account.expert_profile_id })
    if (!data) return null
    return { id: data.id, slug: data.slug, name: data.name, avatarUrl: data.avatar_url, status: data.status }
}
