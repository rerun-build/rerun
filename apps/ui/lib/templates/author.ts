import { templateDocumentSchema, type TemplateDocument } from '@moldwright/contracts'
import { assertTemplateOwnedBy } from '@/app/api/_auth/expert'
import { isPayoutReady } from '@moldwright/cloud/marketplace.server'
import { slugify } from '@/lib/slugify'
import { AppError } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectCount, selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { rowToDocument, TEMPLATE_DOC_COLUMNS, type TemplateRow } from './document'
import {
    EXPERT_TEMPLATE_COLUMNS,
    mergeAuthorDocument,
    templateEditBlockCode,
    toExpertTemplateAgents,
    toExpertTemplates,
    type ExpertTemplate,
    type ExpertTemplateDetail,
    type ExpertTemplateRow,
    type TemplateAuthorPatch,
} from './expert'
import { storeTemplateImageFromUrl } from './images'
import { IMAGE_ALT_LIMIT, MAX_TEMPLATE_GALLERY_IMAGES, MAX_TEMPLATES_PER_AUTHOR } from './limits'
import { describeSecretHit, scanDocumentForSecrets } from './secret-scan'
import { templateSubmitBlockers } from './submit'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { createTemplate, uniqueTemplateSlug, updateTemplateBySlug, type TemplateReviewPatch } from './write'

export type AuthorWrite = { slug: string; warnings: string[] }

export async function listAuthorTemplates(userId: string): Promise<ExpertTemplate[]> {
    const supabase = createServiceRoleClient()
    const { data } = await selectMany(supabase, 'templates', EXPERT_TEMPLATE_COLUMNS, { creator_id: userId }, { column: 'updated_at', ascending: false })
    return toExpertTemplates((data ?? []) as ExpertTemplateRow[])
}

export async function loadAuthorTemplate(userId: string, id: string): Promise<ExpertTemplateDetail> {
    const owned = await assertTemplateOwnedBy(userId, id)
    const supabase = createServiceRoleClient()

    const { data: row } = await selectMaybeSingle(supabase, 'templates', [...TEMPLATE_DOC_COLUMNS, 'submitted_at', 'review_note'] as const, { id: owned.id })
    if (!row) throw new AppError('templateNotFoundDot')

    return {
        id: owned.id,
        status: row.status,
        submittedAt: row.submitted_at,
        reviewNote: row.review_note,
        document: rowToDocument(row as TemplateRow),
        agents: toExpertTemplateAgents(row.agents),
    }
}

export async function createAuthorTemplateDraft(userId: string, title: string): Promise<{ id: string; slug: string }> {
    const trimmed = title.trim()
    if (!trimmed) throw new AppError('titleRequired')

    const base = slugify(trimmed)
    if (!base) throw new AppError('titleUnusableSlug')

    const supabase = createServiceRoleClient()
    const { data: owned } = await selectCount(supabase, 'templates', { creator_id: userId })
    if ((owned ?? 0) >= MAX_TEMPLATES_PER_AUTHOR) throw new AppError('templateLimitReached', { max: MAX_TEMPLATES_PER_AUTHOR })

    const slug = await uniqueTemplateSlug(supabase, base)
    const result = await createTemplate(supabase, templateDocumentSchema.parse({ slug, title: trimmed, creatorId: userId }))
    if (!result.ok) throw new Error(result.error)

    const { data: created } = await selectMaybeSingle(supabase, 'templates', ['id'] as const, { slug: result.slug })
    if (!created) throw new AppError('templateCreatedNotReloaded')

    return { id: created.id, slug: result.slug }
}

export async function loadEditableAuthorDocument(userId: string, id: string): Promise<{ id: string; slug: string; document: TemplateDocument }> {
    const owned = await assertTemplateOwnedBy(userId, id)

    const blocked = templateEditBlockCode(owned.status)
    if (blocked) throw new AppError(blocked)

    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'templates', TEMPLATE_DOC_COLUMNS, { id: owned.id })
    if (!row) throw new AppError('templateNotFoundDot')

    return { id: owned.id, slug: owned.slug, document: rowToDocument(row as TemplateRow) }
}

async function writeAuthorDocument(slug: string, document: TemplateDocument, review?: TemplateReviewPatch): Promise<AuthorWrite> {
    const result = await updateTemplateBySlug(createServiceRoleClient(), slug, document, review)
    if (!result.ok) throw new Error(result.error)
    return { slug: result.slug, warnings: result.warnings }
}

export async function updateAuthorTemplate(userId: string, id: string, patch: TemplateAuthorPatch): Promise<AuthorWrite> {
    const stored = await loadEditableAuthorDocument(userId, id)
    return writeAuthorDocument(stored.slug, templateDocumentSchema.parse(mergeAuthorDocument(stored.document, patch)))
}

export async function submitAuthorTemplate(userId: string, id: string): Promise<AuthorWrite> {
    const stored = await loadEditableAuthorDocument(userId, id)

    const payoutsReady = await isPayoutReady(stored.document.creatorId)
    const missing = templateSubmitBlockers(stored.document, englishTranslator('templates.expert.footer'), { payoutsReady })
    if (missing.length > 0) throw new AppError('addBeforeSubmitting', { fields: missing.join(', ') })

    const secrets = scanDocumentForSecrets(stored.document).map(describeSecretHit)
    if (secrets.length > 0) throw new Error(secrets.join('. '))

    return writeAuthorDocument(stored.slug, { ...stored.document, status: 'in_review' }, { submitted_at: new Date().toISOString(), review_note: null })
}

export async function withdrawAuthorTemplate(userId: string, id: string): Promise<AuthorWrite> {
    const owned = await assertTemplateOwnedBy(userId, id)
    if (owned.status !== 'in_review') throw new AppError('templateNotInReview')

    const supabase = createServiceRoleClient()
    const { data: row } = await selectMaybeSingle(supabase, 'templates', TEMPLATE_DOC_COLUMNS, { id: owned.id })
    if (!row) throw new AppError('templateNotFoundDot')

    return writeAuthorDocument(owned.slug, { ...rowToDocument(row as TemplateRow), status: 'draft' }, { submitted_at: null })
}

export async function deleteAuthorTemplate(userId: string, id: string): Promise<void> {
    const owned = await assertTemplateOwnedBy(userId, id)

    const blocked = templateEditBlockCode(owned.status)
    if (blocked) throw new AppError(blocked)

    const supabase = createServiceRoleClient()
    const { error } = await supabase.from('templates').delete().eq('id', owned.id)
    if (error) throw new Error(error.message)
}

export type AddAuthorImageInput = { imageUrl: string; alt?: string; cover?: boolean }
export type AddedAuthorImage = AuthorWrite & { url: string; position: number; galleryCount: number }

export async function addAuthorTemplateImage(userId: string, id: string, input: AddAuthorImageInput): Promise<AddedAuthorImage> {
    const stored = await loadEditableAuthorDocument(userId, id)
    if (stored.document.gallery.length >= MAX_TEMPLATE_GALLERY_IMAGES) throw new AppError('galleryLimit', { max: MAX_TEMPLATE_GALLERY_IMAGES })

    const url = await storeTemplateImageFromUrl(createServiceRoleClient(), input.imageUrl)
    const image = { url, alt: (input.alt ?? '').slice(0, IMAGE_ALT_LIMIT) }
    const gallery = input.cover ? [image, ...stored.document.gallery] : [...stored.document.gallery, image]

    const written = await writeAuthorDocument(stored.slug, templateDocumentSchema.parse(mergeAuthorDocument(stored.document, { gallery })))
    return { ...written, url, position: input.cover ? 0 : gallery.length - 1, galleryCount: gallery.length }
}
