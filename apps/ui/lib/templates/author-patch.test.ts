import { templateDocumentSchema } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { mergeAuthorDocument, pickSentFields, templateAuthorPatchSchema } from './expert'

const stored = templateDocumentSchema.parse({
    slug: 'inbox-triage',
    title: 'Inbox triage',
    tagline: 'Sort the morning inbox and flag what needs you.',
    longDescription: 'The long version.',
    gallery: [{ url: 'https://media.rerun.build/gallery/cover.webp', alt: 'Board' }],
    faq: [{ question: 'How long does it take?', answer: 'Five minutes.' }],
    tags: ['email'],
})

const patchOf = (sent: Record<string, unknown>) => pickSentFields(templateAuthorPatchSchema.strict().parse(sent), sent)

describe('template author patch', () => {
    it('keeps only the fields the caller sent', () => {
        expect(Object.keys(patchOf({ title: 'New title' }))).toEqual(['title'])
    })

    it('leaves the untouched copy alone', () => {
        const merged = mergeAuthorDocument(stored, patchOf({ title: 'New title' }))

        expect(merged.title).toBe('New title')
        expect(merged.tagline).toBe(stored.tagline)
        expect(merged.longDescription).toBe(stored.longDescription)
        expect(merged.gallery).toEqual(stored.gallery)
        expect(merged.faq).toEqual(stored.faq)
        expect(merged.tags).toEqual(stored.tags)
    })

    it('cannot reach what belongs to us', () => {
        expect(() => patchOf({ status: 'published' })).toThrow()
        expect(() => patchOf({ slug: 'stolen-slug' })).toThrow()
        expect(() => patchOf({ creatorId: '00000000-0000-0000-0000-000000000000' })).toThrow()
        expect(() => patchOf({ featured: true })).toThrow()
    })

    it('refuses a paid template under the floor once merged', () => {
        expect(() => templateDocumentSchema.parse(mergeAuthorDocument(stored, patchOf({ pricingModel: 'one_time', priceAmountCents: 200 })))).toThrow()
        expect(templateDocumentSchema.parse(mergeAuthorDocument(stored, patchOf({ pricingModel: 'one_time', priceAmountCents: 2000 }))).priceAmountCents).toBe(2000)
    })

    it('refuses a price on a free template', () => {
        expect(() => templateDocumentSchema.parse(mergeAuthorDocument(stored, patchOf({ priceAmountCents: 2000 })))).toThrow()
    })
})
