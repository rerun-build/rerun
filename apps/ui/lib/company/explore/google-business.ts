import { runApifyActorWithCost } from '@/lib/experts/apify'
import { companyNameGuess } from './company-name'
import { pointsToDomain } from './social'
import { CollectorSkipped, type Collector } from './types'

const DEFAULT_ACTOR = 'compass/crawler-google-places'

export type GooglePlace = {
    title?: string
    categoryName?: string
    categories?: string[]
    address?: string
    city?: string
    website?: string | null
    phone?: string | null
    totalScore?: number | null
    reviewsCount?: number | null
    reviewsDistribution?: Record<string, number>
    openingHours?: { day: string; hours: string }[]
    price?: string | null
    description?: string | null
    url?: string
    reviewsTags?: { title: string; count: number }[]
    reviews?: { text?: string | null; stars?: number; publishedAtDate?: string }[]
}

export type GoogleBusinessFindings = { query: string; location: string | null; matchesWebsite: boolean; place: GooglePlace }

const KEPT_FIELDS = [
    'title',
    'categoryName',
    'categories',
    'address',
    'city',
    'website',
    'phone',
    'totalScore',
    'reviewsCount',
    'reviewsDistribution',
    'openingHours',
    'price',
    'description',
    'url',
    'reviewsTags',
] as const

function trimPlace(raw: GooglePlace): GooglePlace {
    const place: GooglePlace = Object.fromEntries(KEPT_FIELDS.map(field => [field, raw[field]]))
    place.reviews = (raw.reviews ?? []).map(review => ({ text: review.text, stars: review.stars, publishedAtDate: review.publishedAtDate }))
    return place
}

export const googleBusinessCollector: Collector<'googleBusiness'> = {
    id: 'googleBusiness',
    needs: ['site', 'stack', 'registry'],
    async run({ input, need }) {
        const [site, stack, registry] = await Promise.all([need('site'), need('stack'), need('registry')])
        const query = companyNameGuess(input, stack, site)
        const location = registry?.company?.city ?? null

        const actor = process.env.APIFY_GOOGLE_PLACES_ACTOR ?? DEFAULT_ACTOR
        const { items, usd } = await runApifyActorWithCost<GooglePlace>(
            actor,
            {
                searchStringsArray: [query],
                ...(location ? { locationQuery: `${location}, France` } : {}),
                maxCrawledPlacesPerSearch: 1,
                language: 'fr',
                maxReviews: 5,
                scrapeReviewsPersonalData: false,
            },
            { limit: 1, waitSecs: 75 }
        )
        if (!items[0]) throw new CollectorSkipped(`Aucune fiche Google pour « ${query} »`)

        const place = trimPlace(items[0])
        const matchesWebsite = pointsToDomain(place.website, input.domain)
        return {
            data: { query, location, matchesWebsite, place },
            cost: { usd },
            highlights: [
                `${place.title ?? '?'} · ${place.categoryName ?? '?'}${matchesWebsite ? '' : ' · site différent, sans doute un homonyme'}`,
                `${place.totalScore ?? '?'} / 5 sur ${place.reviewsCount ?? 0} avis`,
                place.address ?? 'Pas d’adresse',
            ],
        }
    },
}
