import { type TemplateDocument, templateDocumentSchema } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'
import { type TemplateRow, documentToRow, rowToDocument } from './document'

const ROW: TemplateRow = {
    id: 't1',
    slug: 'crm-kit',
    title: 'CRM kit',
    tagline: 'Leads on autopilot',
    long_description: 'Long',
    category: 'sales',
    tags: ['crm'],
    gallery: [{ url: 'https://img/1.png', alt: 'cover' }],
    video_url: null,
    og_image_url: null,
    creator_id: null,
    meta_title: null,
    meta_description: null,
    setup_minutes: 10,
    pricing_model: 'one_time',
    price_amount_cents: 1500,
    featured: true,
    lead_magnet: true,
    status: 'published',
    show_in_marketplace: true,
    show_in_library: false,
    agents: [{ key: 'scout', name: 'Scout' }],
    faq: [{ question: 'Q?', answer: 'A.' }],
    story: [],
    role_page: { proof: null, weeklyCost: null, whoHires: [], compare: [] },
}

describe('rowToDocument', () => {
    it('maps the columns onto the document and fills the list defaults', () => {
        const doc = rowToDocument(ROW)
        expect(doc).toMatchObject({ slug: 'crm-kit', longDescription: 'Long', videoUrl: '', metaTitle: '', pricingModel: 'one_time', leadMagnet: true, showInLibrary: false })
        expect(doc.agents[0]).toMatchObject({ key: 'scout', name: 'Scout', role: '', setupRequired: null, skills: [] })
    })

    it('opens a row whose jsonb lists are malformed with empty lists', () => {
        const doc = rowToDocument({ ...ROW, gallery: 'x', agents: [{ key: 'Bad Key' }], faq: null, story: { nope: true }, role_page: { proof: { task: '' } } })
        expect(doc).toMatchObject({ gallery: [], agents: [], faq: [], story: [], rolePage: { proof: null, weeklyCost: null, whoHires: [], compare: [] } })
    })

    it('still refuses a row that breaks a document rule', () => {
        expect(() => rowToDocument({ ...ROW, pricing_model: 'free', price_amount_cents: 100 })).toThrow('A free template has no price')
    })
})

describe('documentToRow', () => {
    it('round-trips a row through the document', () => {
        const connectors = [{ slug: 'hubspot', name: 'HubSpot', icon: null }]
        const { connectors: written, ...row } = documentToRow(rowToDocument(ROW), connectors)
        expect(written).toEqual(connectors)
        expect(row).toEqual({ ...ROW, id: undefined, agents: rowToDocument(ROW).agents })
    })

    it('trims the text, turns blank optional fields into null and drops empty entries', () => {
        const doc: TemplateDocument = templateDocumentSchema.parse({
            slug: 'x',
            title: '  Title  ',
            tagline: ' tag ',
            tags: [' a ', '  '],
            gallery: [{ url: '  ' }, { url: 'https://img' }],
            videoUrl: '   ',
            metaTitle: ' Meta ',
            faq: [
                { question: ' Q ', answer: ' A ' },
                { question: 'Only question', answer: '   ' },
            ],
        })
        expect(documentToRow(doc, [])).toMatchObject({
            title: 'Title',
            tagline: 'tag',
            tags: ['a'],
            gallery: [{ url: 'https://img', alt: '' }],
            video_url: null,
            og_image_url: null,
            meta_title: 'Meta',
            meta_description: null,
            faq: [{ question: 'Q', answer: 'A' }],
        })
    })
})
