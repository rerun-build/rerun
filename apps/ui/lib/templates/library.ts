import {
    type TemplateAgent,
    type TemplateCategory,
    type TemplateConnector,
    type TemplateImage,
    type TemplatePricing,
    type TemplatePricingModel,
    type TemplateStatus,
    templateImageSchema,
} from '@rerun/contracts'
import { z } from 'zod'
import { agentsFromRow, connectorsFromRow } from './document'
import { archiveAgentNames, archivesFromRow } from './archives'
import type { PurchaseAccess } from './entitlement'

// What the in-app library shows of a template: the editorial lists, plus everything a card
// needs. The long description is included so the detail panel does not need a second read.
// `agent_archives` and `creator_id` are read for a derived boolean each, never handed to the
// client: one holds the private bucket paths, the other the author's identity. Both sit outside
// the anon grant, which is why the library reads through the service-role client.
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

// The public fiche that signs a template. Only a published expert profile signs: anything else,
// and every template without an author, is credited to the Rerun team, which is what null says.
export type LibraryCreator = {
    slug: string
    name: string
    kind: 'studio' | 'freelancer' | 'expert'
    avatarUrl: string | null
    bannerUrl: string | null
    location: string | null
    bio: string | null
    links: { x: string | null; linkedin: string | null; github: string | null; website: string | null }
    // The person behind the fiche confirmed it themselves, rather than it being a profile we
    // imported for them.
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
    // The captured agent folders, by display name, in install order. A template with none is
    // editorial only and cannot be imported into a space yet. Names only: the bucket paths the
    // archives also hold never leave the server.
    archiveAgentNames: string[]
    // Whether the viewer authored it. That is what earns a non-published template a place in the
    // list, so the card can show its status the way an admin's does.
    isMine: boolean
    creator: LibraryCreator | null
    pricing: TemplatePricing
    // What the current workspace holds. `lapsed` is a recurring purchase that ended, which the
    // library has to tell apart from never having bought it.
    access: PurchaseAccess
    // The one question every surface asks: can this be placed on a board right now. A free
    // template and one the viewer authored are owned too, so nobody has to re-derive that.
    owned: boolean
    publishedAt: string | null
    // The stored board captures, one per theme. Written by the card renderer after a write, so a
    // freshly saved template shows its previous pair for a few seconds.
    cardImageDarkUrl: string | null
    cardImageLightUrl: string | null
}

const galleryFromRow = z.array(templateImageSchema).catch([])

// `creatorsByUser` is keyed on the account id, which is resolved here and dropped: only the fiche
// it leads to reaches the client.
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

// Values inside a dimension widen the result, dimensions narrow each other.
export type LibraryFilters = {
    connectorSlugs: string[]
    // The admin-only dimension. Empty is not "no narrowing" here but "the public catalogue", which
    // is what the library shows an admin until they ask for a status.
    statuses: TemplateStatus[]
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = { connectorSlugs: [], statuses: [] }

export function filterTemplates(templates: LibraryTemplate[], filters: LibraryFilters): LibraryTemplate[] {
    return templates.filter(t => {
        // With no status asked for, an admin sees what a visitor sees: what is published, plus
        // their own work. For everybody else the read returned nothing else in the first place.
        if (filters.statuses.length > 0) {
            if (!filters.statuses.includes(t.status as TemplateStatus)) return false
        } else if (t.status !== 'published' && !t.isMine) return false
        return filters.connectorSlugs.length === 0 || filters.connectorSlugs.some(slug => t.connectors.some(c => c.slug === slug))
    })
}
