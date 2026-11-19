import {
    EMPTY_TEMPLATE_ROLE_PAGE,
    type TemplateConnector,
    type TemplateDocument,
    templateAgentSchema,
    templateConnectorSchema,
    templateDocumentSchema,
    templateFaqItemSchema,
    templateImageSchema,
    templateRolePageSchema,
    templateStoryStepSchema,
} from '@moldwright/contracts'
import { z } from 'zod'
import type { Database } from '@/app/api/database.types'

export const TEMPLATE_DOC_COLUMNS = [
    'id',
    'slug',
    'title',
    'tagline',
    'long_description',
    'category',
    'tags',
    'gallery',
    'video_url',
    'og_image_url',
    'creator_id',
    'meta_title',
    'meta_description',
    'setup_minutes',
    'pricing_model',
    'price_amount_cents',
    'featured',
    'lead_magnet',
    'status',
    'show_in_marketplace',
    'show_in_library',
    'agents',
    'faq',
    'story',
    'role_page',
    'published_at',
] as const

export type TemplateRow = {
    id: string
    slug: string
    title: string
    tagline: string
    long_description: string
    category: string
    tags: string[]
    gallery: unknown
    video_url: string | null
    og_image_url: string | null
    creator_id: string | null
    meta_title: string | null
    meta_description: string | null
    setup_minutes: number
    pricing_model: string
    price_amount_cents: number
    featured: boolean
    lead_magnet: boolean
    status: string
    show_in_marketplace: boolean
    show_in_library: boolean
    agents: unknown
    faq: unknown
    story: unknown
    role_page: unknown
    published_at?: string | null
    updated_at?: string | null
}

const galleryFromRow = z.array(templateImageSchema).catch([])
export const agentsFromRow = z.array(templateAgentSchema).catch([])
const faqFromRow = z.array(templateFaqItemSchema).catch([])
const storyFromRow = z.array(templateStoryStepSchema).catch([])
const rolePageFromRow = templateRolePageSchema.catch(EMPTY_TEMPLATE_ROLE_PAGE)
export const connectorsFromRow = z.array(templateConnectorSchema).catch([])

export function rowToDocument(row: TemplateRow): TemplateDocument {
    return templateDocumentSchema.parse({
        slug: row.slug,
        title: row.title,
        tagline: row.tagline ?? '',
        longDescription: row.long_description ?? '',
        category: row.category,
        tags: row.tags ?? [],
        gallery: galleryFromRow.parse(row.gallery),
        videoUrl: row.video_url ?? '',
        ogImageUrl: row.og_image_url ?? '',
        creatorId: row.creator_id,
        metaTitle: row.meta_title ?? '',
        metaDescription: row.meta_description ?? '',
        setupMinutes: row.setup_minutes,
        pricingModel: row.pricing_model,
        priceAmountCents: row.price_amount_cents,
        featured: row.featured,
        leadMagnet: row.lead_magnet,
        status: row.status,
        showInMarketplace: row.show_in_marketplace,
        showInLibrary: row.show_in_library,
        agents: agentsFromRow.parse(row.agents),
        faq: faqFromRow.parse(row.faq),
        story: storyFromRow.parse(row.story),
        rolePage: rolePageFromRow.parse(row.role_page),
    })
}

export function documentToRow(doc: TemplateDocument, connectors: TemplateConnector[]): Database['public']['Tables']['templates']['Insert'] {
    return {
        slug: doc.slug,
        title: doc.title.trim(),
        tagline: doc.tagline.trim(),
        long_description: doc.longDescription,
        category: doc.category,
        tags: doc.tags.map(t => t.trim()).filter(Boolean),
        gallery: doc.gallery.filter(i => i.url.trim()),
        video_url: doc.videoUrl.trim() || null,
        og_image_url: doc.ogImageUrl.trim() || null,
        creator_id: doc.creatorId,
        meta_title: doc.metaTitle.trim() || null,
        meta_description: doc.metaDescription.trim() || null,
        setup_minutes: doc.setupMinutes,
        pricing_model: doc.pricingModel,
        price_amount_cents: doc.priceAmountCents,
        featured: doc.featured,
        lead_magnet: doc.leadMagnet,
        status: doc.status,
        show_in_marketplace: doc.showInMarketplace,
        show_in_library: doc.showInLibrary,
        agents: doc.agents,
        faq: doc.faq.map(item => ({ question: item.question.trim(), answer: item.answer.trim() })).filter(item => item.question && item.answer),
        story: doc.story,
        role_page: doc.rolePage,
        connectors,
    }
}
