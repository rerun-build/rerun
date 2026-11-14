import { isPublicStatus, isSeoDescriptionLength, type TemplateDocument } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidateLanding } from '@/lib/landing-revalidate'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { resolveAgentConnectors } from './connectors'
import { documentToRow } from './document'
import { describeSecretHit, scanDocumentForSecrets } from './secret-scan'
import { submitRequirementLabel } from './submit'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { renderTemplateCard } from './card-render'

export type TemplateWriteResult = { ok: true; slug: string; warnings: string[] } | { ok: false; status: number; error: string }

export async function uniqueTemplateSlug(supabase: SupabaseClient<Database>, base: string, currentSlug?: string): Promise<string> {
    for (let i = 1; ; i++) {
        const candidate = i === 1 ? base : `${base}-${i}`
        if (candidate === currentSlug) return candidate

        const { data } = await selectMaybeSingle(supabase, 'templates', ['id'] as const, { slug: candidate })
        if (!data) return candidate
    }
}

function publishGate(doc: TemplateDocument): string[] {
    if (!isPublicStatus(doc.status)) return []
    const missing: string[] = []
    if (!doc.tagline.trim()) missing.push('a tagline')
    if (!isSeoDescriptionLength(doc.metaDescription)) missing.push(submitRequirementLabel('metaDescription', englishTranslator('templates.expert.footer')).toLowerCase())
    if (doc.gallery.length === 0 && doc.agents.length === 0) missing.push('at least one image or captured coworker')
    return missing.length > 0 ? [`Cannot publish without ${missing.join(' and ')}`] : []
}

async function paidPublishBlockers(supabase: SupabaseClient<Database>, doc: TemplateDocument): Promise<string[]> {
    if (!isPublicStatus(doc.status) || doc.pricingModel === 'free') return []
    if (!doc.creatorId) return ['A paid template must belong to a creator account']

    const { data } = await selectMaybeSingle(supabase, 'creator_accounts', ['charges_enabled', 'payouts_enabled'] as const, { user_id: doc.creatorId })
    if (!data?.charges_enabled || !data.payouts_enabled) return ['The creator cannot receive payouts yet, so this template cannot be published as paid']

    return []
}

type BuiltRow = { ok: false; error: string } | { ok: true; row: ReturnType<typeof documentToRow>; warnings: string[] }

async function buildRow(supabase: SupabaseClient<Database>, doc: TemplateDocument): Promise<BuiltRow> {
    const { connectors, warnings: connectorWarnings } = await resolveAgentConnectors(supabase, doc.agents)

    const publishing = isPublicStatus(doc.status)
    const secretHits = scanDocumentForSecrets(doc).map(describeSecretHit)
    const blocking = [...publishGate(doc), ...(await paidPublishBlockers(supabase, doc)), ...(publishing ? secretHits : [])]
    if (blocking.length > 0) return { ok: false, error: blocking.join('. ') }

    return { ok: true, row: documentToRow(doc, connectors), warnings: [...connectorWarnings, ...secretHits] }
}

export async function createTemplate(supabase: SupabaseClient<Database>, doc: TemplateDocument): Promise<TemplateWriteResult> {
    const built = await buildRow(supabase, doc)
    if (!built.ok) return { ok: false, status: 400, error: built.error }

    const { data: clash, error: readError } = await selectMaybeSingle(supabase, 'templates', ['id'] as const, { slug: doc.slug })
    if (readError) return { ok: false, status: 500, error: readError.message }
    if (clash) return { ok: false, status: 409, error: `A template with slug "${doc.slug}" already exists` }

    const { error } = await supabase
        .from('templates')
        .insert<Database['public']['Tables']['templates']['Insert']>({ ...built.row, published_at: isPublicStatus(doc.status) ? new Date().toISOString() : null })
    if (error) return { ok: false, status: 500, error: error.message }

    if (isPublicStatus(doc.status)) await pingTemplateRevalidate(doc.slug, null, [doc.category])
    return { ok: true, slug: doc.slug, warnings: built.warnings }
}

export type TemplateReviewPatch = { submitted_at?: string | null; review_note?: string | null }

export async function updateTemplateBySlug(
    supabase: SupabaseClient<Database>,
    slug: string,
    doc: TemplateDocument,
    review: TemplateReviewPatch = {},
): Promise<TemplateWriteResult> {
    const { data: existing, error: readError } = await selectMaybeSingle(supabase, 'templates', ['id', 'slug', 'category', 'published_at'] as const, { slug })
    if (readError) return { ok: false, status: 500, error: readError.message }
    if (!existing) return { ok: false, status: 404, error: `No template found with slug "${slug}"` }

    const built = await buildRow(supabase, doc)
    if (!built.ok) return { ok: false, status: 400, error: built.error }

    if (doc.slug !== slug) {
        const { data: clash } = await selectMaybeSingle(supabase, 'templates', ['id'] as const, { slug: doc.slug })
        if (clash) return { ok: false, status: 409, error: `A template with slug "${doc.slug}" already exists` }
    }

    const published_at = isPublicStatus(doc.status) ? (existing.published_at ?? new Date().toISOString()) : null

    const { error } = await supabase
        .from('templates')
        .update<Database['public']['Tables']['templates']['Update']>({ ...built.row, ...review, published_at, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    if (error) return { ok: false, status: 500, error: error.message }

    await pingTemplateRevalidate(doc.slug, doc.slug === slug ? null : slug, [doc.category, existing.category])
    return { ok: true, slug: doc.slug, warnings: built.warnings }
}

export async function pingTemplateRevalidate(slug: string | null, previousSlug: string | null, categories: (string | null)[] = []) {
    const categoryPaths = [...new Set(categories.filter(Boolean))].map(category => `/templates/category/${category}`)
    const paths = [
        '/templates',
        ...(slug ? [`/templates/${slug}`] : []),
        ...(previousSlug ? [`/templates/${previousSlug}`] : []),
        ...categoryPaths,
    ]

    await revalidateLanding(paths)

    if (slug) void renderTemplateCard(slug).then(changed => (changed ? revalidateLanding(paths) : undefined))
}
