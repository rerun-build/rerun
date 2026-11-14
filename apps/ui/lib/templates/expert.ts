import { isPublicStatus, templateDocumentObject, type TemplateDocument, type TemplatePricing, type TemplatePricingModel, type TemplateStatus } from '@rerun/contracts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/app/api/database.types'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { agentsFromRow } from './document'

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

export type ExpertTemplateAgent = { key: string; name: string; role: string; connectorSlugs: string[]; setupRequired: boolean | null }

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

export function templateEditBlockCode(status: string): 'templateInReview' | 'templatePublished' | null {
    if (status === 'in_review') return 'templateInReview'
    return isPublicStatus(status as TemplateStatus) ? 'templatePublished' : null
}

export function templateEditBlockReason(status: string): string | null {
    if (status === 'in_review') return 'This template is waiting for our review. Withdraw it to keep editing.'
    return isPublicStatus(status as TemplateStatus) ? 'This template has been published and can no longer be edited.' : null
}

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
    pricingModel: true,
    priceAmountCents: true,
})
export type TemplateAuthorInput = z.infer<typeof templateAuthorSchema>

export const templateAuthorPatchSchema = templateAuthorSchema.partial()
export type TemplateAuthorPatch = z.infer<typeof templateAuthorPatchSchema>

export function pickSentFields(parsed: TemplateAuthorPatch, sent: Record<string, unknown>): TemplateAuthorPatch {
    return Object.fromEntries(Object.entries(parsed).filter(([key]) => key in sent)) as TemplateAuthorPatch
}

export function mergeAuthorDocument(stored: TemplateDocument, patch: TemplateAuthorPatch): TemplateDocument {
    return { ...stored, ...patch }
}

export type ExpertProfile = { id: string; slug: string; name: string; avatarUrl: string | null; status: string }

export async function resolveExpertForUser(supabase: SupabaseClient<Database>, userId: string): Promise<ExpertProfile | null> {
    const { data: account } = await selectMaybeSingle(supabase, 'users', ['expert_profile_id'] as const, { id: userId })
    if (!account?.expert_profile_id) return null

    const { data } = await selectMaybeSingle(supabase, 'experts', ['id', 'slug', 'name', 'avatar_url', 'status'] as const, { id: account.expert_profile_id })
    if (!data) return null
    return { id: data.id, slug: data.slug, name: data.name, avatarUrl: data.avatar_url, status: data.status }
}
