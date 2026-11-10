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

// `currentSlug` is the row the caller is about to write: a template keeps its own slug instead
// of being pushed to `-2` every time its metadata is regenerated.
export async function uniqueTemplateSlug(supabase: SupabaseClient<Database>, base: string, currentSlug?: string): Promise<string> {
    for (let i = 1; ; i++) {
        const candidate = i === 1 ? base : `${base}-${i}`
        if (candidate === currentSlug) return candidate

        const { data } = await selectMaybeSingle(supabase, 'templates', ['id'] as const, { slug: candidate })
        if (!data) return candidate
    }
}

// A published or unlisted template is a public page, so it must be complete. Drafts may be
// saved in any state. `metaTitle` is not required, the public page falls back to the title. The
// meta description is: a tagline is written for a card, and is almost never the length a search
// result needs.
function publishGate(doc: TemplateDocument): string[] {
    if (!isPublicStatus(doc.status)) return []
    const missing: string[] = []
    if (!doc.tagline.trim()) missing.push('a tagline')
    if (!isSeoDescriptionLength(doc.metaDescription)) missing.push(submitRequirementLabel('metaDescription', englishTranslator('templates.expert.footer')).toLowerCase())
    // The cards draw the board of a captured agent, so an image is only the fallback thumbnail of a
    // template that has none.
    if (doc.gallery.length === 0 && doc.agents.length === 0) missing.push('at least one image or captured coworker')
    return missing.length > 0 ? [`Cannot publish without ${missing.join(' and ')}`] : []
}

// Selling requires somewhere to send the money. Checked on the way to the public page rather than
// at save time, so an author can price a draft before finishing their Stripe onboarding. Every
// write path funnels through buildRow, so this one insertion covers the admin editor, the review
// approval and anything added later.
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

    // The scan is a heuristic, so a false positive must never cost the author their draft:
    // it only turns blocking on the way to the public page.
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

    // A draft has no landing page, so revalidating it would ping a 404 on every creation.
    if (isPublicStatus(doc.status)) await pingTemplateRevalidate(doc.slug, null, [doc.category])
    return { ok: true, slug: doc.slug, warnings: built.warnings }
}

// The review columns are not part of the document: they describe the handover between an author
// and us, not the page. They ride along here so a status change and its trace are one write.
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

    // A slug change orphans the old landing path, so both have to be revalidated.
    await pingTemplateRevalidate(doc.slug, doc.slug === slug ? null : slug, [doc.category, existing.category])
    return { ok: true, slug: doc.slug, warnings: built.warnings }
}

// Categories are their own indexable landing routes, so a template moving between them
// leaves both listings stale.
export async function pingTemplateRevalidate(slug: string | null, previousSlug: string | null, categories: (string | null)[] = []) {
    const categoryPaths = [...new Set(categories.filter(Boolean))].map(category => `/templates/category/${category}`)
    const paths = [
        '/templates',
        ...(slug ? [`/templates/${slug}`] : []),
        ...(previousSlug ? [`/templates/${previousSlug}`] : []),
        ...categoryPaths,
    ]

    // The editorial change lands now, so unpublishing stays instant.
    await revalidateLanding(paths)

    // The board capture is two round trips to Rerun Shot, which the author must not sit through, so
    // it runs detached and revalidates a second time once the row points at the new images. Without
    // that second ping the pages would have been rebuilt mid-capture and would keep the old card.
    if (slug) void renderTemplateCard(slug).then(changed => (changed ? revalidateLanding(paths) : undefined))
}
