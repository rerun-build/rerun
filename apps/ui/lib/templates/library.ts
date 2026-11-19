import {
    type TemplateAgent,
    type TemplateCategory,
    type TemplateConnector,
    type TemplateImage,
    type TemplatePricing,
    type TemplatePricingModel,
    type TemplateStatus,
    templateImageSchema,
} from '@moldwright/contracts'
import { z } from 'zod'
import { agentsFromRow, connectorsFromRow } from './document'
import { archiveAgentNames, archivesFromRow } from './archives'
import type { PurchaseAccess } from './entitlement'

export const LIBRARY_COLUMNS = [
    'id',
    'slug',
    'title',
    'tagline',
    'long_description',
    'category',
    'tags',
    'gallery',
    'setup_minutes',
    'featured',
    'status',
    'agent_count',
    'agents',
    'connectors',
    'agent_archives',
    'creator_id',
    'pricing_model',
    'price_amount_cents',
    'price_currency',
    'published_at',
    'card_image_dark_url',
    'card_image_light_url',
] as const

export type LibraryRow = {
    id: string
    slug: string
    title: string
    tagline: string | null
    long_description: string | null
    category: string
    tags: string[] | null
    gallery: unknown
    setup_minutes: number
    featured: boolean
    status: string
    agent_count: number | null
    agents: unknown
    connectors: unknown
    agent_archives: unknown
    creator_id: string | null
    pricing_model: string
    price_amount_cents: number
    price_currency: string
    published_at: string | null
    card_image_dark_url: string | null
    card_image_light_url: string | null
}

export type LibraryCreator = {
    slug: string
    name: string
    kind: 'studio' | 'freelancer' | 'expert'
    avatarUrl: string | null
    bannerUrl: string | null
    location: string | null
    bio: string | null
    links: { x: string | null; linkedin: string | null; github: string | null; website: string | null }
    verified: boolean
}

export type LibraryTemplate = {
    id: string
    slug: string
    title: string
    tagline: string
    longDescription: string
    category: TemplateCategory
    tags: string[]
    gallery: TemplateImage[]
    setupMinutes: number
    featured: boolean
    status: string
    agentCount: number
    agents: TemplateAgent[]
    connectors: TemplateConnector[]
    archiveAgentNames: string[]
    isMine: boolean
    creator: LibraryCreator | null
    pricing: TemplatePricing
    access: PurchaseAccess
    owned: boolean
    publishedAt: string | null
    cardImageDarkUrl: string | null
    cardImageLightUrl: string | null
}

const galleryFromRow = z.array(templateImageSchema).catch([])

export function toLibraryTemplates(rows: LibraryRow[], viewerId?: string | null, accessByTemplate?: Map<string, PurchaseAccess>, creatorsByUser?: Map<string, LibraryCreator>): LibraryTemplate[] {
    const templates = rows.map(row => {
        const agents = agentsFromRow.parse(row.agents)
        const isMine = !!viewerId && row.creator_id === viewerId
        const pricing: TemplatePricing = { model: row.pricing_model as TemplatePricingModel, amountCents: row.price_amount_cents, currency: row.price_currency }
        const access = accessByTemplate?.get(row.id) ?? 'none'

        return {
            id: row.id,
            slug: row.slug,
            title: row.title,
            tagline: row.tagline ?? '',
            longDescription: row.long_description ?? '',
            category: row.category as TemplateCategory,
            tags: row.tags ?? [],
            gallery: galleryFromRow.parse(row.gallery),
            setupMinutes: row.setup_minutes,
            featured: row.featured,
            status: row.status,
            agentCount: row.agent_count ?? 0,
            agents,
            connectors: connectorsFromRow.parse(row.connectors),
            archiveAgentNames: archiveAgentNames(archivesFromRow.parse(row.agent_archives), agents),
            isMine,
            creator: (row.creator_id && creatorsByUser?.get(row.creator_id)) || null,
            pricing,
            access,
            owned: pricing.model === 'free' || isMine || access === 'active',
            publishedAt: row.published_at,
            cardImageDarkUrl: row.card_image_dark_url,
            cardImageLightUrl: row.card_image_light_url,
        }
    })

    return templates.sort((a, b) => Number(b.featured) - Number(a.featured))
}

export type LibraryFilters = {
    connectorSlugs: string[]
    statuses: TemplateStatus[]
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = { connectorSlugs: [], statuses: [] }

export function isInMyLibrary(template: LibraryTemplate): boolean {
    return template.isMine || template.access !== 'none'
}

export function filterTemplates(templates: LibraryTemplate[], filters: LibraryFilters): LibraryTemplate[] {
    return templates.filter(t => {
        if (filters.statuses.length > 0) {
            if (!filters.statuses.includes(t.status as TemplateStatus)) return false
        } else if (t.status !== 'published' && !t.isMine) return false
        return filters.connectorSlugs.length === 0 || filters.connectorSlugs.some(slug => t.connectors.some(c => c.slug === slug))
    })
}
