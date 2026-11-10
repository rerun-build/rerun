import type { TemplateCategory, TemplateFaqItem } from '@rerun/contracts'
import { z } from 'zod'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { slugify } from '@/lib/slugify'
import { failure, isErrorCode, type ActionFailure } from '@/lib/i18n/action-error'
import { loadServiceCatalog } from './catalog'
import { templateBriefSchema, withConnectorNames } from './describe'
import { uploadTemplateImageBytes, type TemplateImageFolder } from './images'
import { generateImageAltText, generateTemplateContent, generateTemplateFaq, generateTemplateMeta } from './prefill'
import { uniqueTemplateSlug } from './write'

// Writing a template is the same job whoever does it: the admin editor and the author panel run
// the same prefill and the same image upload. What differs is who
// is allowed to, so the guard stays in the action files and everything below is auth-free.

export type UploadResult = { ok: true; url: string } | ActionFailure
export type ContentPrefillResult = { ok: true; tagline: string; longDescription: string } | ActionFailure
// `slug` is absent for an author: they do not own the URL of the page, so their prefill leaves it alone.
export type MetaPrefillResult =
    | { ok: true; title: string; slug?: string; category: TemplateCategory; tags: string[]; metaTitle: string; metaDescription: string }
    | ActionFailure
export type FaqPrefillResult = { ok: true; faq: TemplateFaqItem[] } | ActionFailure
export type AltTextResult = { ok: true; alt: string } | ActionFailure

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export const faqPrefillInputSchema = z.object({
    brief: templateBriefSchema,
    longDescription: z.string().default(''),
})

export const altTextInputSchema = z.object({
    brief: templateBriefSchema,
    imageUrl: z.string().url('uploadImageBeforeAltText'),
    isCover: z.boolean().default(false),
})

function issues(error: z.ZodError): ActionFailure {
    const code = error.issues.map(issue => issue.message).find(isErrorCode)
    return code ? failure(code) : { ok: false, error: error.issues.map(issue => issue.message).join('\n') }
}

export async function runImageUpload(formData: FormData, folder: TemplateImageFolder): Promise<UploadResult> {
    const file = formData.get('file')
    if (!(file instanceof File)) return failure('noFileProvided')
    if (!file.type.startsWith('image/')) return failure('chooseImage')
    if (file.size > MAX_IMAGE_BYTES) return failure('imageTooLarge', { max: MAX_IMAGE_BYTES / 1024 / 1024 })

    const url = await uploadTemplateImageBytes(createServiceRoleClient(), await file.arrayBuffer(), folder)
    return { ok: true, url }
}

export async function runContentPrefill(input: unknown): Promise<ContentPrefillResult> {
    const parsed = templateBriefSchema.safeParse(input)
    if (!parsed.success) return issues(parsed.error)

    const { tagline, longDescription } = await generateTemplateContent(parsed.data)
    return { ok: true, tagline, longDescription }
}

// `currentSlug` doubles as the switch: given one, the writer proposes a new slug for that row;
// given none, the caller has no say over the URL and only the copy comes back.
export async function runMetaPrefill(input: unknown, currentSlug?: string): Promise<MetaPrefillResult> {
    const parsed = templateBriefSchema.safeParse(input)
    if (!parsed.success) return issues(parsed.error)

    const supabase = createServiceRoleClient()
    const catalog = await loadServiceCatalog(supabase, parsed.data.connectors)
    const names = new Map([...catalog].map(([slug, entry]) => [slug, entry.name]))

    const { title, slugWords, category, tags, metaTitle, metaDescription } = await generateTemplateMeta(withConnectorNames(parsed.data, names))
    const slug = currentSlug === undefined ? undefined : await uniqueTemplateSlug(supabase, slugify(slugWords) || slugify(title), currentSlug)

    return { ok: true, title, slug, category, tags, metaTitle, metaDescription }
}

export async function runFaqPrefill(input: unknown): Promise<FaqPrefillResult> {
    const parsed = faqPrefillInputSchema.safeParse(input)
    if (!parsed.success) return issues(parsed.error)

    return { ok: true, faq: await generateTemplateFaq(parsed.data) }
}

export async function runAltTextPrefill(input: unknown): Promise<AltTextResult> {
    const parsed = altTextInputSchema.safeParse(input)
    if (!parsed.success) return issues(parsed.error)

    return { ok: true, alt: await generateImageAltText(parsed.data) }
}
